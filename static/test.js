"use strict"

var assert = function(val) {
    if (!val) {
        throw Error('Assert error with value "' + val + '"');

    }
};

var assert_equal = function(a, b) {
    if (a !== b) {
        console.log('%c NOT OK "' + a + '" != "' + b + '"',
                    'background:red;color:white;');
        console.trace()
    } else {
        console.log("%c OK", 'color:green;');
    }
};

var test = function() {
    var count = 0;

    // test subscribe and dispose
    var x = new Observable(1);
    var xsub = function(v) {
        count += 1;
    }
    var dispose = x.subscribe(xsub);
    x(1);
    assert_equal(count, 0);
    x(2);
    assert_equal(count, 1);
    x(2);
    assert_equal(count, 1);
    var xsub2 = function(v) {
        count += 2;
    }
    var dispose2 = x.subscribe(xsub2);
    x(3);
    assert_equal(count, 4);
    dispose();
    x(4);
    assert_equal(count, 6);
    dispose2();
    x(5);
    assert_equal(count, 6);
    x.subscribe(xsub);
    x.trigger();
    assert_equal(count, 7);

    // Assert value update inside obserable (no infinite loop)
    var y = new Observable(1);
    var mult2 = function(v) {
        y(v * 2);
    };
    y.subscribe(mult2);
    y(3);
    assert_equal(y(), 6);

    // test computed observable
    var x = new Observable(1);
    var y = new Observable(0.1);
    var total_count = 0;
    var total = new Observable(function() {
        total_count += 1;
        return x() + x() + y();
    });
    assert_equal(total(), 2.1)
    x(0);
    x(0);
    assert_equal(total(), 0.1)
    assert_equal(total_count, 2)


    // Mix computed and subscriber
    var computed_count = 0;
    var subscribe_count = 0;
    var z = new Observable('ham');
    z() // if the computed is accessed first it get
    var computed = new Observable(function() {
        z()
        computed_count++;
    })
    z.subscribe(function () {
        subscribe_count++;
    });
    z('spam');
    z('foo');
    // +1 because computed trigger an empty run:
    assert_equal(subscribe_count+1, computed_count)


    // DOM tests
    var my_val = new Observable();
    var types = [
        'checkbox',
        'color',
        'date',
        'datetime',
        'email',
        'month',
        'password',
        'range',
        'text',
        'week',
    ];
    for (var pos in types) {
        var type = types[pos];
        build_ui(type, my_val);
    };

    // test radio
    var input1 = $('<input/>', {
        'type': 'radio',
        'value': 'radio1',
        'name': 'test',
    });
    var input2 = $('<input/>', {
        'type': 'radio',
        'value': 'radio2',
        'name': 'test',
    });
    $('body').append(input1, input2);
    input1 = new Observable.$(input1);
    input1.val(my_val);

    input2 = new Observable.$(input2);
    input2.val(my_val);

    my_val.subscribe(function() {
        console.log('radio', my_val());
    });
}


var build_ui = function(type, my_val) {
    var input = $('<input/>', {
        'type': type,
    });
    var button = $('<button/>', {
        'text': 'click',
    });
    $('body').append(input, button);
    input = new Observable.$(input);
    input.val(my_val);

    my_val.subscribe(function() {
        console.log(type, my_val());
    });

    button.click(function() {
        console.log('click', my_val());
    });

};

$(test);
