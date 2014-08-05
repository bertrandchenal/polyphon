
# Polyphon

## Usage

The daemon can be launched with

    polyphond.py [config-file]

If the config file argument is missing the config will be loaded from
`~/.polyphon.png`.


Example config file:

    [main]
    music = ~/my_music
    static = ~/optinal_path_to_static

    [radio]
    BBC1 = bbcmedia.ic.llnwd.net/stream/bbcmedia_intl_lc_radio1_p

If static is not given the default layout will be used.
