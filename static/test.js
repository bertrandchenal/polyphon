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


    // Mix computed and subsriber
    count = 7;
    var z = new Observable('ham');
    var computed = new Observable(function() {
        z()
    })
    var y = new Observable('ham');
    z.subscribe(function () {
        count++;
    });
    z('spam');
    assert_equal(count, 8)
}
$(test);
