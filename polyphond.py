import fcntl
import configparser
import logging
import os
import subprocess
import select
import sys
import threading
from time import sleep

from bottle import Bottle, route, run, static_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('polyphon')
CTX = None
LI_TPL = '''
<li>
  <a href="#" data-url="{url}"
     class="{type}">{name}
  </a>
</li>
'''
COMMANDS = [
    b'get_file_name',
    b'get_time_pos',
    b'get_time_length',
]


class Context:

    def __init__(self, option):
        if not 'music' in option:
            exit('"music" path not defined')

        self.music = self.expand_path(option['music'])
        self.static = self.expand_path(option.get('static', 'static'))
        self.radios = option.get('radios', [])
        self.status = {}
        self.process = None

    @staticmethod
    def expand_path(path):
        path = os.path.expanduser(path)
        if not os.path.exists(path):
            exit('Path "%s" not found' % path)
        return path

    def browse(self, kind, path):
        if kind == 'file':
            res = []

            rel_path = os.path.join(*path) if path else ''
            full_path = os.path.join(self.music, rel_path)

            for name in os.listdir(full_path):
                f = os.path.join(full_path, name)
                yield {
                    'type': 'dir' if os.path.isdir(f) else 'file',
                    'url': name,
                    'name': name.replace('_', ' ')
                }

        elif kind == 'http':
            for name, url in self.radios:
                yield {
                    'type': 'file',
                    'url': url,
                    'name': name.replace('_', ' ')
                }

    def pause(self):
        if self.process and self.process.returncode is None:
            self.paused = not self.paused
            self.process.stdin.write(b'pause\n')
            self.process.stdin.flush()

    def play(self, kind, names, path):
        threading.Thread(target=self.launch_process,
                         args=(kind, names, path)).start()

    def launch_process(self, kind, names, path):
        if self.process:
            self.process.stdin.write(b'quit\n')
            self.process.wait()

        cmd = "mplayer -slave -quiet -idle"
        self.paused = False
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
                load_cmd = 'loadfile "%s"' % os.path.join(base, name)
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
                self.update_status(data.decode())

    def update_status(self, data):
        if not data.startswith('ANS_'):
            return
        key, val = data[4:].split('=')
        self.status[key.lower()] = val.strip().strip("'")

@route('/static/<filename>')
def static(filename):
    return static_file(filename, root=CTX.static)

@route('/')
def index():
    return static('index.html')

@route('/status')
def status():
    return CTX.status

@route('/browse/<path:path>')
def browse(path):
    path_list = path.split('/')
    if not path_list:
        return ''
    kind = path_list.pop(0)
    items = CTX.browse(kind, path_list)
    return '\n'.join(LI_TPL.format(**i) for i in items)

@route('/play/<path:path>')
def play(path):
    kind, tail = path.split('/', 1)
    if kind == 'file':
        *folder, names = tail.split('/')
        if not names:
            return
    else:
        names = tail
        folder = None
    names = names.split('+')
    CTX.play(kind, names, folder)

@route('/pause')
def pause():
    CTX.pause()

def load_config():

    if len(sys.argv) > 1:
        config_file = sys.argv[1]
    else:
        config_file = os.path.expanduser('~/.polyphon.cfg')

    if not os.path.exists(config_file):
        exit('Config file "%s" not found' % config_file)

    config = configparser.ConfigParser()
    config.read(config_file)

    option = {}

    if not 'main' in config:
        exit('Section "main" missing in config file')
    for key in config['main']:
        option[key] = config['main'][key]

    option['radios'] = []
    if not 'radios' in config:
        return option

    for key in config['radios']:
        value = config['radios'][key]
        if value.startswith('http://'):
            value = value[7:]
        option['radios'].append((key, value))
    return option


if __name__ == '__main__':
    CTX = Context(load_config())
    run(host='localhost', port=8000, debug=True)
