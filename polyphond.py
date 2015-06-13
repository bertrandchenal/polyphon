#! /usr/bin/env python3
import configparser
import gzip
import json
import logging
import mimetypes
import os
import subprocess
import select
import sys
import threading
from base64 import b64encode
from io import StringIO, BytesIO
from logging.handlers import RotatingFileHandler
from time import sleep

from flask import Flask, jsonify, request, send_file

try:
    from PIL import Image
except ImportError:
    Image = None

PLAY_PAUSE_LOCK = threading.Lock()
MAX_LEN = 2*10**4

CTX = None
BROWSE_LRU = None

IMG_TPL = '''
<li>
  <a href="show/file/{url}"
     class="{type}">
    <img src="data:image/png;base64,{src}"> {name}
  </a>
</li>
'''
FILE_TPL = '''
<li>
<a href="#" data-url="{url}"
   class="{type}">{name}
</a>
</li>
'''
MORE_TPL = '''
<li>
<a href="#" class="more" after="%s">
More
</a>
</li>
'''

COMMANDS = [
    b'get_file_name',
    b'get_time_pos',
    b'get_time_length',
]

app = Flask("polyphon")


class ChrootException(Exception):
    pass

class SizeException(Exception):
    pass

class LRU:

    def __init__(self, size=1000):
        self.fresh = {}
        self.stale = {}
        self.size = size

    def get(self, key, default=None):
        if key in self.fresh:
            return self.fresh[key]

        if key in self.stale:
            value = self.stale[key]
            # Promote key to fresh dict
            self.set(key, value)
            return value
        return default

    def clean(self):
        # Fresh is put in stale, new empty fresh is created
        self.stale = self.fresh
        self.fresh = {}

    def set(self, key, value):
        self.fresh[key] = value
        if len(self.fresh) > self.size:
            self.clean()


class Context:

    def __init__(self, option):
        if not option.get('music'):
            app.logger.error('Music path not defined')
            exit()

        self.music = self.expand_path(option.music)
        self.static = self.expand_path(option.static)
        self.radios = option.radios
        self.status = {'paused': None}
        self.paused = None
        self.process = None

    @staticmethod
    def expand_path(path):
        path = os.path.expanduser(path)
        if not os.path.exists(path):
            app.logger.error('Path "%s" not found' % path)
            exit()
        return os.path.realpath(path)


    def browse_item(self, path, name):
        f = os.path.join(path, name)
        is_dir = os.path.isdir(f)
        is_img = False
        if not is_dir and Image:
            filetype, _ = mimetypes.guess_type(f)
            if filetype:
                mediatype, subtype = filetype.split('/')
                is_img = mediatype == 'image'

        if not is_img:
            return FILE_TPL.format(**{
                'type': 'dir' if is_dir else 'file',
                'url': name,
                'name': name.replace('_', ' '),
            })

        im = Image.open(f)
        im.thumbnail((36,36))

        imbuf = BytesIO()
        im.save(imbuf, format=subtype)
        imstr = b64encode(imbuf.getvalue()).decode()

        return IMG_TPL.format(**{
            'type': 'img',
            'url': os.path.join(path, name),
            'name': name.replace('_', ' '),
            'src': imstr,
        })

    def browse(self, kind, path, after):
        total_len = 0
        if kind == 'file':
            res = []

            rel_path = os.path.join(*path) if path else ''
            full_path = os.path.join(self.music, rel_path)
            self.check_root(full_path)

            names = os.listdir(full_path)
            names.sort()
            if after:
                names = names[after:]
            for pos, name in enumerate(names):
                if name.startswith('.'):
                    continue
                item = self.browse_item(full_path, name)
                total_len += len(item)
                if total_len > MAX_LEN:
                    yield MORE_TPL % (after + pos)
                    return
                yield item

        elif kind == 'http':
            for name, url in self.radios:
                attr = {
                    'type': 'file',
                    'url': url,
                    'name': name.replace('_', ' ')
                }
                item = FILE_TPL.format(**attr)
                total_len += len(item)
                if total_len > MAX_LEN:
                    yield MORE_TPL % after + pos
                    return
                yield item

    def pause(self):
        if self.process and self.process.returncode is None:
            self.process.stdin.write(b'pause\n')
            self.process.stdin.flush()

            self.paused = not self.paused
            self.status['paused'] = self.paused

    def play(self, kind, names, path):
        self.paused = False
        self.status['paused'] = self.paused
        self.status['playing_path'] = [kind] + path
        threading.Thread(target=self.launch_process,
                         args=(kind, names, path)).start()

    def launch_process(self, kind, names, path):
        if self.process:
            if not self.process.stdin.closed:
                self.process.stdin.write(b'quit\n')
                self.process.stdin.flush()

        cmd = "mplayer -slave -quiet -idle"
        self.process = subprocess.Popen(
            cmd,
            shell=True,
            bufsize=1,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE
        )

        threading.Thread(target=self.write_loop, args=(self.process,)).start()
        threading.Thread(target=self.read_loop, args=(self.process,)).start()

        for pos, name in enumerate(names):
            if kind == 'file':
                base = os.path.join(self.music, *path)
                full_path = os.path.join(base, name)
                self.check_root(full_path)
                load_cmd = 'loadfile "%s"' % full_path
            else:
                load_cmd = 'loadfile "http://%s"' %  name

            if pos > 0:
                load_cmd += " 1"
            load_cmd += "\n"

            self.process.stdin.write(load_cmd.encode())
            self.process.stdin.flush()

        self.process.wait()

    def write_loop(self, process):
        while True:
            sleep(1)
            if process.returncode is not None:
                process.stdin.close()
                return

            if self.paused:
                continue

            for cmd in COMMANDS:
                process.stdin.write(b'pausing_keep ' + cmd + b'\n')
                process.stdin.flush()

    def read_loop(self, process):
        while True:
            if process.returncode is not None:
                process.stdout.close()
                return

            ready, _, _ = select.select([process.stdout], [], [], 1.0)

            if ready:
                data = process.stdout.readline()
                self.update_status(data.decode('utf-8', errors='ignore'))

    def update_status(self, data):
        if not data.startswith('ANS_'):
            return
        key, val = data[4:].split('=')
        self.status[key.lower()] = val.strip().strip("'")

    def check_root(self, path):
        real = os.path.realpath(path)
        if not os.path.commonprefix([real, self.music]) == self.music:
            raise ChrootException('Invalid path')



@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/status')
def status():
    return jsonify(**CTX.status)

@app.route('/browse/<path:json_args>')
def browse(json_args):
    args = json.loads(json_args)
    path_list = args.get('p')
    after = args.get('a', 0)
    content = BROWSE_LRU.get(json_args)

    if not content:
        if not path_list:
            return ''
        kind = path_list.pop(0)
        items = CTX.browse(kind, path_list, after)

        content = '\n'.join(items)
        content = gzip.compress(content.encode())
        BROWSE_LRU.set(json_args, content)

    resp = app.response_class()
    accept_encoding = request.headers.get('Accept-Encoding', '')
    if 'gzip' not in accept_encoding.lower():
        resp.set_data(gzip.decompress(content))
    else:
        resp.headers['Content-Encoding'] = 'gzip'
        resp.set_data(content)
    return resp

@app.route('/show/<path:path>')
def show(path):
    kind, tail = path.split('/', 1)
    full_path = os.path.join(CTX.music, tail)
    return send_file(full_path)


@app.route('/play/<path:path>')
def play(path):
    kind, tail = path.split('/', 1)
    if kind == 'file':
        *folder, names = tail.split('/')
        if not names:
            return
    else:
        names = tail
        folder = []
    names = names.split('+')

    with PLAY_PAUSE_LOCK:
        CTX.play(kind, names, folder)
    return 'ok'

@app.route('/pause')
def pause():
    with PLAY_PAUSE_LOCK:
        CTX.pause()
    return 'ok'


class Option:

    def __init__(self, **kw):
        self.__dict__.update(kw)

    def get(self, key, default=None):
        return getattr(self, key, default)


def load_config():

    if len(sys.argv) > 1:
        config_file = sys.argv[1]
    else:
        config_file = os.path.expanduser('~/.polyphon.cfg')

    if not os.path.exists(config_file):
        exit('Config file "%s" not found' % config_file)


    config = configparser.ConfigParser()
    # The default optionxform converts key to lowercase
    config.optionxform = str
    config.read(config_file)

    curr_path = os.path.dirname(os.path.abspath(__file__))
    default_static = os.path.join(curr_path, 'static')
    default_log = os.path.join(curr_path, 'polyphon.log')
    data = {
        'static': default_static,
        'logfile': default_log,
    }

    if not 'main' in config:
        exit('Section "main" missing in config file')

    for key in config['main']:
        data[key] = config['main'][key]

    data['radios'] = []
    if not 'radios' in config:
        return data

    for key in config['radios']:
        value = config['radios'][key]
        if value.startswith('http://'):
            value = value[7:]
        data['radios'].append((key, value))

    return Option(**data)


if __name__ == '__main__':
    option = load_config()
    handler = RotatingFileHandler(option.logfile)
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter(
        '%(asctime)s:%(name)s:%(levelname)s:%(message)s')
    handler.setFormatter(formatter)
    app.logger.addHandler(handler)

    CTX = Context(option)
    if option.get('debug'):
        BROWSE_LRU = LRU(0)
    else:
        BROWSE_LRU = LRU()

    app.static_folder = option.static

    app.logger.warning('Server started')
    app.run(host='0.0.0.0', port=8081, threaded=True, debug=option.get('debug'))
