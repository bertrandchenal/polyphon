#! /usr/bin/env python3
import fcntl
import configparser
import logging
import os
import subprocess
import select
import sys
import threading
from logging.handlers import RotatingFileHandler
from time import sleep

from flask import Flask, jsonify

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

app = Flask("polyphon")

class Context:

    def __init__(self, option):
        if not option.music:
            exit('"music" path not defined')

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
            exit('Path "%s" not found' % path)
        return path

    def browse(self, kind, path):
        if kind == 'file':
            res = []

            rel_path = os.path.join(*path) if path else ''
            full_path = os.path.join(self.music, rel_path)

            names = os.listdir(full_path)
            names.sort()
            for name in names:
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
            self.process.stdin.write(b'pause\n')
            self.process.stdin.flush()

            self.paused = not self.paused
            self.status['paused'] = self.paused

    def play(self, kind, names, path):
        self.paused = False
        self.status['paused'] = self.paused
        self.status['playing_path'] = path
        threading.Thread(target=self.launch_process,
                         args=(kind, names, path)).start()

    def launch_process(self, kind, names, path):
        if self.process:
            self.process.stdin.write(b'quit\n')
            self.process.stdin.flush()
            self.process.wait()

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
                self.update_status(data.decode('utf-8', errors='ignore'))

    def update_status(self, data):
        if not data.startswith('ANS_'):
            return
        key, val = data[4:].split('=')
        self.status[key.lower()] = val.strip().strip("'")


@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/status')
def status():
    return jsonify(**CTX.status)

@app.route('/browse/<path:path>')
def browse(path):
    path_list = path.split('/')
    if not path_list:
        return ''
    kind = path_list.pop(0)
    items = CTX.browse(kind, path_list)
    return '\n'.join(LI_TPL.format(**i) for i in items)

@app.route('/play/<path:path>')
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
    return 'ok'

@app.route('/pause')
def pause():
    CTX.pause()
    return 'ok'


class Option:

    def __init__(self, **kw):
        self.__dict__.update(kw)


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

    data = {
        'static': 'static',
        'logfile': 'polyphon.log',
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
    CTX = Context(option)
    app.static_folder = option.static

    handler = RotatingFileHandler(option.logfile)
    handler.setLevel(logging.INFO)
    app.logger.addHandler(handler)

    app.run(host='0.0.0.0', port=8081)
