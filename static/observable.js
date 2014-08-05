"use strict"

// The observable constructor. If the param is a function, it will be
// considered as computed observable (I.E readonly), if not, the
// param value is user as the initial value of a simple observable.
var Observable = function(value) {

    if (!this)
        throw Error('Observable constructor requires "new" operator');

    this.subscribers = [];
    this.trigger_runnning = false;

    if (typeof value === 'function') {
        // Computed observable
        this.value = new Observable();
        this.computed = value;
        this.to_dispose = [];
        this.trigger_computed();
        return this.value;
    } else {
        // Simple value
        this.value = value;
        var getset = this.getset.bind(this);
        getset.subscribe = Observable.subscribe.bind(this);
        getset.equal = Observable.set_equal.bind(this);
        getset.trigger = Observable.prototype.trigger.bind(this);
        return getset;
    };
};

// The getset method allows to get (when no param is passed) the
// observable value or update it (if one param is given). If the new
// value differs from the old one, the trigger method is called.
Observable.prototype.getset = function(value) {
    if (arguments.length && !this.equal(this.value, value)) {
        var old_value = this.value
        this.value = value;
        this.trigger(this.value, old_value);
    } else {
        Observable.last_get(this);
    }
    return this.value;
};

// equal tells if the current values is equal to the given param
Observable.prototype.equal = function(a, b) {
    return a === b;
};

// set_equal allows to define custom equal function
Observable.set_equal = function(fn) {
    this.equal = fn.bind(this);
};

// The trigger method is responsible to call all the subscribed
// functions of the observable. It avoids to re-run itself there is a
// loop of subscribers.
Observable.prototype.trigger = function(old_value) {
    if (this.trigger_runnning) {
        return;
    }
    this.trigger_runnning = true;
    for (var pos in this.subscribers) {
        this.subscribers[pos](this.value, old_value);
    }
    this.trigger_runnning = false;
};

// The trigger computed method is run a first time when the observable
// is defined. It will be called again when one of the observable that
// have been neccessary to compute it is changed.
Observable.prototype.trigger_computed = function() {
    // Dispose observables from previous run
    for (var pos in this.to_dispose) {
        this.to_dispose[pos]();
    }
    this.to_dispose = [];

    // Record which observables are accessed ..
    var to_subscribe = [];
    var dispose = Observable.last_get.subscribe(function(obj) {
        if (to_subscribe.indexOf(obj) < 0 && this !== obj) {
            to_subscribe.push(obj);
        }
    });
    this.value(this.computed());
    dispose();

    // .. subscribe them & collect corresponding dispose functions
    for (var pos in to_subscribe) {
        this.to_dispose.push(
            Observable.subscribe(this.trigger_computed.bind(this),
                                 to_subscribe[pos])
        );
    }
};

// The subscribe method allows to attach a callback function 'fn' that
// will be triggered when the observable change. If 'obs' is given,
// the subscribe function will attach the collback to the given
// observable instead of attaching it to 'this'. It returns a dispose
// method which, if called, will detach (or unsubscribe) the callback
// function.
Observable.subscribe = function(fn, obs) {
    if (!obs) {
        obs = this;
    }
    var binded = fn.bind(obs);
    obs.subscribers.push(binded);
    var dispose = function() {
        for (var pos in obs.subscribers) {
            if (obs.subscribers[pos] === binded) {
                obs.subscribers.splice(pos, 1);
            }
        };
    };
    return dispose;
};

// Global observable to collect which other observable is accessed
Observable.last_get = new Observable();

// helper to define auto-updating dom element
// Ex: el('input', {'type': 'text', 'val': my_observable})
Observable.bind = function(tag, args) {
    var el = $(tag);
    new Observable(function() {
        for (var key in args) {
            var arg = args[key];
            if (arg.subscribe && typeof arg.subscribe == 'function') {
                // arg is an observable
                arg = arg();
            } else if (typeof arg == 'function') {
                arg = arg.bind(el)
            }
            if (el[key]) {
                el[key](arg)
            } else {
                el.attr(key, arg);
            }
        }
    });
    return el;
};
