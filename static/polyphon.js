"use strict"

var PAUSE_ICO = '<i class="icon-pause"></i>';
var PLAY_ICO = '<i class="icon-play"></i>';
var UPD_TIMER = null;


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

var Ctx = function(el) {
    this.el = el;
    this.path = ['file'];
    this.drill_stack = [];
    this.paused = new Observable();
    this.filename = new Observable();
    this.track_pos = new Observable('');
    this.track_percent = new Observable('1%');
    this.playing_path = new Observable();

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
    this.listing = this.el.find('#listing');
    this.listing.on('click', 'a.file', this.play.bind(this));
    this.listing.on('click', 'a.dir', this.drill.bind(this));
    this.el.find('#up').click(this.go_up.bind(this));
    this.el.find('#radio').click(this.go_radio.bind(this));
    this.el.find('#file').click(this.go_file.bind(this));

    this.footer = this.el.find('#footer');
    this.status = this.el.find('#status');

    this.browse();
    this.update_status();
};

Ctx.prototype.drill = function(ev) {
    var el = $(ev.target);
    this.highlight(el.parent('li'));
    var name = el.attr('data-url');
    this.path.push(name);
    this.drill_stack.push(this.listing.find('li').detach());
    this.browse();
};

Ctx.prototype.go_up = function() {
    if (this.path.length > 1) {
        // First element contains source type
        this.path.pop();
        var items = this.drill_stack.pop();
        this.listing.html(items);
        this.update_kb_nav();
        this.auto_scroll();
    }
};

Ctx.prototype.go_radio = function() {
    this.path = ['http']
    this.browse();
};


Ctx.prototype.go_file = function() {
    this.path = ['file']
    this.browse();
};

Ctx.prototype.browse = function() {
    var prm = $.get('browse/' + this.path.join('/'))

    prm.done(function(files) {
        this.listing.html(files);
        this.update_kb_nav()
    }.bind(this));
};

Ctx.prototype.do_pause = function() {
    var prm = $.get('pause');
    prm.done(this.update_status.bind(this));
};

Ctx.prototype.get_data_name = function(el) {
    return el.getAttribute('data-url');
};

Ctx.prototype.play = function(ev) {
    // Update highlight
    var el = $(ev.target);
    this.highlight(el.parent('li'));

    if (this.path[0] == 'file') {
        var names = $.map(
            el.parent().nextAll('li').addBack().children('a.file'),
            this.get_data_name
        );
    } else {
        var names = [this.get_data_name(el)];
    }

    var prm = $.get('play/' + this.path.join('/') + '/' + names.join('+'))
    prm.done(this.update_status.bind(this));
};

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


Ctx.prototype.highlight = function(el, old_el) {
    if (!old_el) {
        old_el = this.listing.find('.highlight');
    }
    old_el.removeClass('highlight');
    el.addClass('highlight');
};

Ctx.prototype.go_next = function(backward) {
    var el = $('.highlight');
    if (!el.length) {
        var sel = backward ? 'li:last-child': 'li:first-child';
        el = this.listing.find(sel);
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


Ctx.prototype.update_kb_nav = function() {
    return
    var el = this.listing.find('.highlight');
    if (!el.length) {
        el = this.listing.find('li:first-child');
        this.highlight(el)
    }
}


Ctx.prototype.auto_scroll = function() {
    var el = this.listing.find('.highlight');
    if (!el.length) {
        el = this.listing.find('.active');
    }
    if (!el.length) {
        return;
    }

    var scroll_pos = Math.max($('html').scrollTop(),
                              $('body').scrollTop())
    var el_pos = el.offset().top
    var el_height = el.height()
    var page = $(window).height() * 0.6;
    var footer_pos = this.footer.offset().top;
    var status_pos = this.status.offset().top;
    var footer_height = this.footer.height();
    var status_height = this.status.height();

    if (el_pos < status_pos + status_height + el_height) {
        $('body, html').scrollTop(scroll_pos - page);
    } else if (el_pos + footer_height >= footer_pos) {
        $('body, html').scrollTop(scroll_pos + page);
    }
};


var init = function() {
    var ctx = new Ctx($('body'));

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
            ctx.listing.find('.highlight a').click();
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
