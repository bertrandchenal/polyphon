"use strict"

var PAUSE_ICO = '<i class="icon-pause"></i>';
var PLAY_ICO = '<i class="icon-play"></i>';
var UPD_TIMER = null;
var SCR_TIMER = null;


var divmod = function(dividend, divisor) {
    var mod = dividend % divisor;
    var div = (dividend - mod) /divisor;
    return [div, mod]
};

var fmt_sec = function(val) {
    var res = val.toString();
    if (res.length == 1) {
        res = "0" + res;
    }
    return res;
};

var Ctx = function(el, params) {
    this.el = el;
    this.path = params.p || ['file'];
    this.after = params.a;
    this.browse_cache = {};
    this.paused = new Observable();
    this.filename = new Observable();
    this.track_pos = new Observable('');
    this.track_percent = new Observable('1%');
    this.playing_path = new Observable([]);
    this.listing = new Observable();
    this.listing_ul = $('#listing');

    // Plug subscribers
    this.listing.subscribe(function(new_value) {
        this.listing_ul.html(new_value);
        this.update_active();
        this.auto_scroll();
    }.bind(this));
    this.playing_path.subscribe(function(new_) {
        this.update_active();
    }.bind(this));

    // Bind DOM
    Observable.bind('#track_pos', {
        'text': this.track_pos
    })

    Observable.bind('#percent_bar', {
        'width': this.track_percent
    })

    Observable.bind('#filename', {
        'text': this.filename
    });

    Observable.bind('#pause', {
        'html': function() {
            if (this.paused() === null) {
                return '';
            }
            return this.paused() ? PLAY_ICO : PAUSE_ICO;
        }.bind(this)
    }).click(this.do_pause.bind(this));


    // Bind DOM events
    this.listing_ul.on('click', 'a.file', this.play.bind(this));

    this.listing_ul.on('click', 'a.dir', this.drill.bind(this));
    this.el.find('#up').click(this.go_up.bind(this));
    this.el.find('#radio').click(this.go_radio.bind(this));
    this.el.find('#file').click(this.go_file.bind(this));
    $('body').on('click', '.more', this.load_more.bind(this));

    this.footer = this.el.find('#footer');
    this.header = this.el.find('#header');


    // Show home screen
    this.browse();
    // Launch update loop
    this.update_status();
 };

Ctx.prototype.set_state = function(params) {
    this.path = params.p;
    this.after = params.a;
    this.browse();
};

Ctx.prototype.drill = function(ev) {
    this.after = 0;
    var el = $(ev.target);
    this.highlight(el.parent('li'));
    var name = el.attr('data-url');
    this.path.push(name);
    this.browse();
    return false;
};

Ctx.prototype.go_up = function() {
    this.after = 0;
    if (this.path.length > 1) {
        // First element contains source type
        this.path.pop();
    }
    this.browse()
    return false;
};

Ctx.prototype.go_radio = function() {
    this.path = ['http']
    this.browse();
    return false;
};


Ctx.prototype.go_file = function() {
    this.path = ['file']
    this.browse();
    return false;
};

Ctx.prototype.load_more = function(ev) {
    var target = $(ev.target);
    this.after = parseInt(target.attr('after'));
    target.text('Loading ...');
    this.browse();
    return false;
};

Ctx.prototype.browse = function() {
    var state = {
        'p': this.path,
    }
    if (this.after > 0) {
        state['a'] = this.after;
    }
    var params = JSON.stringify(state);
    var hash = '#' + params;

    if (window.location.hash != hash) {
        window.history.pushState(null, "Title", hash);
    }

    var cached = this.browse_cache[params]
    if (cached) {
        this.listing(cached);
        return
    }
    $.get('browse/' + params).done(function(files) {
        this.browse_cache[params] = files;
        this.listing(files);
    }.bind(this));
};

Ctx.prototype.do_pause = function() {
    var prm = $.get('pause');
    prm.done(this.update_status.bind(this));
    return false;
};


Ctx.prototype.play = function(ev) {
    // Update highlight
    var el = $(ev.target);
    this.highlight(el.parent('li'));

    if (this.path[0] == 'file') {
        var names = $.map(
            el.parent().nextAll('li').addBack().children('a.file'),
            function (e) {return $(e).data('url');}
        );
    } else {
        var names = [el.data('url')];
    }

    var prm = $.get('play/' + this.path.join('/') + '/' + names.join('+'))
    prm.done(this.update_status.bind(this));
    return false;
};

Ctx.prototype.show = function(ev) {
    var el = $(ev.target);
    var data_url = el.attr('data-url');
    var url = 'show/' + this.path.join('/') + '/' + data_url
    window.location = url;
    return false;
}

Ctx.prototype.update_status = function() {
    // Clear any existing timer
    clearTimeout(UPD_TIMER);

    // Call server
    var prm = $.getJSON('status');

    // Clean result & trigger observables
    prm.done(function(status) {
        this.paused(status.paused)
        this.playing_path(status.playing_path);
        this.filename(status.filename);

        if (status.time_position) {
            var pos = status.time_position.split('.')[0]
            var len = status.length.split('.')[0]
            var min_sec_pos = divmod(pos, 60);
            var min_sec_len = divmod(len, 60);
            this.track_pos(min_sec_pos[0] + ':' + fmt_sec(min_sec_pos[1])
                           + ' / '
                           + min_sec_len[0] + ':' + fmt_sec(min_sec_len[1])
                          );
            this.track_percent((100*pos/len) + '%');
        }
    }.bind(this));

    // Set new timer
    prm.always(function() {
        UPD_TIMER = setTimeout(this.update_status.bind(this), 1000);
    }.bind(this));
    return prm;
};

Ctx.prototype.update_active = function() {
    var pp = this.playing_path();
    var path_pos = 0;

    if (!pp) return;

    for (;path_pos < this.path.length; path_pos++) {
        if (this.path[path_pos] != pp[path_pos]) {
            return;
        }
    }
    var name;
    if (path_pos == pp.length) {
        name = this.filename();
    } else {
        name = pp[path_pos];
    }

    this.listing_ul.find('a').each(function(el_pos, el) {
        el = $(el);
        if (el.data('url') == name) {
            // Clear existing active
            this.listing_ul.find('.active').removeClass('active');
            // Set new active
            el.addClass('active');
            return;
        }
    }.bind(this));
};

Ctx.prototype.highlight = function(el, old_el) {
    if (!old_el) {
        old_el = this.listing_ul.find('.highlight');
    }
    old_el.removeClass('highlight');
    el.addClass('highlight');
};

Ctx.prototype.go_next = function(backward) {
    var el = $('.highlight');
    if (!el.length) {
        var sel = backward ? 'li:last-child': 'li:first-child';
        el = this.listing_ul.find(sel);
        sibling = el;
    } else {
        var sibling = backward ? el.prev() : el.next();
    }

    if (!sibling.length) {
        return;
    }
    this.highlight(sibling, el);
    this.auto_scroll();
};


Ctx.prototype.auto_scroll = function() {
    var el = this.listing_ul.find('.highlight');
    if (!el.length) {
        el = this.listing_ul.find('.active');
    }
    if (!el.length) {
        return;
    }

    clearTimeout(SCR_TIMER);
    SCR_TIMER = setTimeout(function() {
        var scroll_pos = Math.max($('html').scrollTop(),
                                  $('body').scrollTop())
        var el_pos = el.offset().top
        var el_height = el.height()
        var page = $(window).height() * 0.6;
        var footer_pos = this.footer.offset().top;
        var header_pos = this.header.offset().top;
        var footer_height = this.footer.height();
        var header_height = this.header.height();

        var goto_pos;

        if (el_pos < header_pos + header_height + el_height) {
            // Higher than header -> scrolling up
            var delta = header_pos + header_height + el_height - el_pos;
            goto_pos = scroll_pos - Math.max(page, delta);
        } else if (el_pos + footer_height >= footer_pos) {
            // Lower than footer -> scrolling down
            var delta = el_pos + footer_height - footer_pos;
            goto_pos = scroll_pos + Math.max(page, delta);
        }
        $('body, html').scrollTop(goto_pos);
    }.bind(this), 10);
};


var get_state = function() {
    var params;
    try {
        params = JSON.parse(window.location.hash.slice(1));
    } catch(e) {
        console.log(e)
        params = {};
    }
    var path = params['p'];
    if (!path) {
        return {};
    }
    if (['file', 'http'].indexOf(path[0]) != 0) {
        return {}
    }
    return params;
};

var init = function() {
    var params = get_state();
    var ctx = new Ctx($('body'), params);

    window.onpopstate = function(event) {
        ctx.set_state(get_state());
    };

    $('body').keydown(function (ev) {
        if (ev.ctrlKey || ev.altKey) {
            return;
        }

        if (ev.which == 'P'.charCodeAt(0)) {
            ctx.do_pause();
            return;
        }

        switch(ev.which) {
        case 38:
            // up
            ctx.go_next(true);
            break;
        case 40:
            // down
            ctx.go_next();
            break;
        case 13: // return
        case 39: // right
            ctx.listing_ul.find('.highlight a').click();
            break;
        case 8: // backspace
        case 37: // left
            ctx.go_up();
            break;
        default:
            return;
        }
        return false;
    });

};

$(init);
