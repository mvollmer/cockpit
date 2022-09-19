/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import QUnit from "qunit-tests";

function deep_update(target, data) {
    for (const prop in data) {
        if (Object.prototype.toString.call(data[prop]) === '[object Object]') {
            if (!target[prop])
                target[prop] = {};
            deep_update(target[prop], data[prop]);
        } else {
            target[prop] = data[prop];
        }
    }
}

export function common_dbus_tests(channel_options, bus_name) { // eslint-disable-line no-unused-vars
    QUnit.test("call method", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        assert.equal(typeof dbus.call, "function", "is a function");
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"])
                .done(function(reply) {
                    assert.deepEqual(reply, ["Word! You said `Browser-side JS'. I'm Skeleton, btw!"], "reply");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.butNotForPy("call method with timeout", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "NeverReturn", [], { timeout: 10 })
                .done(function(reply) {
                    assert.ok(false, "should not be reached");
                })
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.Timeout");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "call timed out");
                    done();
                });
    });

    QUnit.test("close immediately", function (assert) {
        const done = assert.async();
        assert.expect(1);
        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.addEventListener("close", function(event, options) {
            assert.equal(options.problem, "test-code", "got right code");
            done();
        });

        window.setTimeout(function() {
            dbus.close("test-code");
        }, 100);
    });

    QUnit.test("call close", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"])
                .fail(function(ex) {
                    assert.equal(ex.problem, "disconnected", "got right close code");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "call rejected");
                    done();
                });

        dbus.close();
    });

    QUnit.test("call closed", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.close("blah-blah");

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"])
                .fail(function(ex) {
                    assert.equal(ex.problem, "blah-blah", "got right close code");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "call rejected");
                    done();
                });
    });

    QUnit.test("primitive types", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestPrimitiveTypes", [
                      10, true, 11, 12, 13, 14, 15, 16, 17,
                      "a string", "/a/path", "asig",
                      "ZWZnAA=="])
                .done(function(reply) {
                    assert.deepEqual(reply, [
                        20, false, 111, 1012, 10013, 100014, 1000015, 10000016, 17.0 / Math.PI,
                        "Word! You said `a string'. Rock'n'roll!", "/modified/a/path", "assgitasig",
                        "Ynl0ZXN0cmluZyH/AA=="
                    ], "round trip");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.butNotForPy("integer bounds", function (assert) {
        assert.expect(35);

        const dbus = cockpit.dbus(bus_name, channel_options);

        function testNumber(type, value, valid) {
            const done = assert.async();

            dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                      "TestVariant", [{ t: type, v: value }])
                    .fail(function(ex) {
                        assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs");
                    })
                    .always(function() {
                        if (valid)
                            assert.equal(this.state(), "resolved", "accepted in bounds number");
                        else
                            assert.equal(this.state(), "rejected", "rejected out of bounds number");
                        done();
                    });
        }

        testNumber('y', 0, true);
        testNumber('y', 0xff, true);
        testNumber('y', -1, false);
        testNumber('y', 0xff + 1, false);
        testNumber('n', -300, true);
        testNumber('n', 300, true);
        testNumber('n', -0x8000 - 1, false);
        testNumber('n', 0x7fff + 1, false);
        testNumber('q', 0, true);
        testNumber('q', 300, true);
        testNumber('q', -1, false);
        testNumber('q', 0xffff + 1, false);
        testNumber('i', -0xfffff, true);
        testNumber('i', 0xfffff, true);
        testNumber('i', -0x80000000 - 1, false);
        testNumber('i', 0x7fffffff + 1, false);
        testNumber('u', 0, true);
        testNumber('u', 0xfffff, true);
        testNumber('u', -1, false);
        testNumber('u', 0xffffffff + 1, false);
        testNumber('x', -0xfffffffff, true);
        testNumber('x', 0xfffffffff, true);
        testNumber('t', 0xfffffffff, true);
        testNumber('t', -1, false);
    });

    QUnit.test("non-primitive types", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestNonPrimitiveTypes", [
                      { one: "red", two: "blue" },
                      { first: [42, 42], second: [43, 43] },
                      [42, 'foo', 'bar'],
                      ["one", "two"],
                      ["/one", "/one/two"],
                      ["ass", "git"],
                      ["QUIA", "QkMA"]])
                .done(function(reply) {
                    assert.deepEqual(reply, [
                        "{'one': 'red', 'two': 'blue'}{'first': (42, 42), 'second': (43, 43)}(42, 'foo', 'bar')array_of_strings: [one, two] array_of_objpaths: [/one, /one/two] array_of_signatures: [signature 'ass', 'git'] array_of_bytestrings: [AB, BC] "
                    ], "round trip");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test("variants", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestAsv", [{
                      one: cockpit.variant("s", "foo"),
                      two: cockpit.variant("o", "/bar"),
                      three: cockpit.variant("g", "assgit"),
                      four: cockpit.variant("y", 42),
                      five: cockpit.variant("d", 1000.0)
                  }])
                .done(function(reply) {
                    assert.deepEqual(reply, [
                        "{'one': <'foo'>, 'two': <objectpath '/bar'>, 'three': <signature 'assgit'>, 'four': <byte 0x2a>, 'five': <1000.0>}"
                    ], "round trip");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.butNotForPy("bad variants", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestAsv", [{
                      one: "foo",
                      two: "/bar",
                      three: "assgit",
                      four: 42,
                      five: 1000.0
                  }])
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                    assert.equal(ex.message, "Unexpected type 'string' in argument", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test("get all", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "org.freedesktop.DBus.Properties",
                  "GetAll", ["com.redhat.Cockpit.DBusTests.Frobber"])
                .done(function(reply) {
                    assert.deepEqual(reply, [{
                        FinallyNormalName: { t: "s", v: "There aint no place like home" },
                        ReadonlyProperty: { t: "s", v: "blah" },
                        aay: { t: "aay", v: [] },
                        ag: { t: "ag", v: [] },
                        ao: { t: "ao", v: [] },
                        as: { t: "as", v: [] },
                        ay: { t: "ay", v: "QUJDYWJjAA==" },
                        b: { t: "b", v: false },
                        d: { t: "d", v: 43 },
                        g: { t: "g", v: "" },
                        i: { t: "i", v: 0 },
                        n: { t: "n", v: 0 },
                        o: { t: "o", v: "/" },
                        q: { t: "q", v: 0 },
                        s: { t: "s", v: "" },
                        t: { t: "t", v: 0 },
                        u: { t: "u", v: 0 },
                        x: { t: "x", v: 0 },
                        y: { t: "y", v: 42 }
                    }], "reply");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test("call unimplemented", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "UnimplementedMethod", [])
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
                    assert.equal(ex.message, "Method UnimplementedMethod is not implemented on interface com.redhat.Cockpit.DBusTests.Frobber", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test.butNotForPy("call bad base64", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "TestPrimitiveTypes", [10, true, 11, 12, 13, 14, 15, 16, 17, "a string", "/a/path", "asig",
                      "Yooohooo!~ bad base64"])
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                    assert.equal(ex.message, "Invalid base64 in argument", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test.butNotForPy("call unknown", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "UnknownBlahMethod", [1])
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.UnknownMethod", "error name");
                    assert.equal(ex.message, "Introspection data for method com.redhat.Cockpit.DBusTests.Frobber UnknownBlahMethod not available", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test("signals", function (assert) {
        const done = assert.async();
        assert.expect(6);

        let received = false;
        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.subscribe({
            interface: "com.redhat.Cockpit.DBusTests.Frobber",
            path: "/otree/frobber"
        }, function(path, iface, signal, args) {
            if (received)
                return;
            assert.equal(path, "/otree/frobber", "got right path");
            assert.equal(iface, "com.redhat.Cockpit.DBusTests.Frobber", "got right path");
            assert.equal(signal, "TestSignal", "signals: got right path");
            assert.deepEqual(args, [
                43, ["foo", "frobber"], ["/foo", "/foo/bar"],
                { first: [42, 42], second: [43, 43] }], "got right arguments");
            received = true;
        });

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [0])
                .always(function() {
                    assert.equal(this.state(), "resolved", "emission requested");
                    assert.equal(received, true, "signal received");
                    done();
                });
    });

    QUnit.test("signal unsubscribe", function (assert) {
        const done = assert.async();
        assert.expect(4);

        let received = true;
        const dbus = cockpit.dbus(bus_name, channel_options);

        function on_signal() {
            received = true;
        }

        const subscription = dbus.subscribe({
            interface: "com.redhat.Cockpit.DBusTests.Frobber",
            path: "/otree/frobber"
        }, on_signal);

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [0])
                .always(function() {
                    assert.equal(this.state(), "resolved", "emission requested");
                    assert.equal(received, true, "signal received");
                })
                .then(function() {
                    subscription.remove();
                    received = false;

                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RequestSignalEmission", [0])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "second emission requested");
                                assert.equal(received, false, "signal not received");
                                done();
                            });
                });
    });

    QUnit.test.butNotForPy("with types", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [{ one: "red", two: "blue" }, 55, 66, 32],
                  { type: "a{ss}uit" })
                .done(function(reply, options) {
                    assert.deepEqual(reply, [{ one: "red", two: "blue" }, 55, 66, 32], "round trip");
                    assert.equal(options.type, "a{ss}uit", "got back type");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.butNotForPy("with meta", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const meta = {
            "borkety.Bork": {
                methods: {
                    Echo: {
                        in: ["a{ss}", "u", "i", "t"],
                        out: ["a{ss}", "u", "i", "t"]
                    }
                }
            }
        };

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.addEventListener("meta", function(event, data) {
            assert.deepEqual(data, meta, "got meta data");
        });

        dbus.meta(meta);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [{ one: "red", two: "blue" }, 55, 66, 32])
                .then(function(reply) {
                    assert.deepEqual(reply, [{ one: "red", two: "blue" }, 55, 66, 32], "returned round trip");
                }, function(ex) {
                    console.log(ex);
                    assert.ok(false, "shouldn't fail");
                })
                .always(function() {
                    dbus.close();
                    done();
                });
    });

    QUnit.test.butNotForPy("empty base64", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo",
                  [""],
                  { type: "ay" })
                .done(function(reply, options) {
                    assert.deepEqual(reply, [""], "round trip");
                    assert.equal(options.type, "ay", "got back type");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test.butNotForPy("bad object path", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("invalid/path", "borkety.Bork", "Echo", [1])
                .fail(function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error name");
                    assert.equal(ex.message, "object path is invalid in dbus \"call\": invalid/path", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("bad interface name", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/path", "!invalid!interface!", "Echo", [1])
                .fail(function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error name");
                    assert.equal(ex.message, "interface name is invalid in dbus \"call\": !invalid!interface!", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("bad method name", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/path", "borkety.Bork", "!Invalid!Method!", [1])
                .fail(function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error name");
                    assert.equal(ex.message, "member name is invalid in dbus \"call\": !Invalid!Method!", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("bad flags", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/path", "borkety.Bork", "Method", [1], { flags: 5 })
                .fail(function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error name");
                    assert.equal(ex.message, "the \"flags\" field is invalid in dbus call", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("bad types", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo", [1],
                  { type: "!!%%" })
                .fail(function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error name");
                    assert.equal(ex.message, "the \"type\" signature is not valid in dbus call: !!%%", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test.butNotForPy("bad type invalid", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo", [1], { type: 5 }) // invalid
                .fail(function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error name");
                    assert.equal(ex.message, "the \"type\" field is invalid in call", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test.butNotForPy("bad dict type", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", [{ "!!!": "value" }], { type: "a{is}" })
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                    assert.equal(ex.message, "Unexpected key '!!!' in dict entry", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test.butNotForPy("bad object path", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", ["not/a/path"], { type: "o" })
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                    assert.equal(ex.message, "Invalid object path 'not/a/path'", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test.butNotForPy("bad signature", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "Nobody", ["bad signature"], { type: "g" })
                .fail(function(ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.InvalidArgs", "error name");
                    assert.equal(ex.message, "Invalid signature 'bad signature'", "error message");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "should fail");
                    done();
                });
    });

    QUnit.test("flags", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["test"], { flags: "" })
                .done(function(reply, options) {
                    assert.equal(typeof options.flags, "string", "is string");
                    assert.ok(options.flags.indexOf(">") !== -1 || options.flags.indexOf("<") !== -1, "has byte order");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test("without introspection", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/bork", "borkety.Bork", "Echo")
                .done(function(reply) {
                    assert.deepEqual(reply, [], "round trip");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    done();
                });
    });

    QUnit.test("watch path", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch("/otree/frobber")
                .done(function() {
                    assert.equal(typeof cache["/otree/frobber"], "object", "has path");
                    assert.deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                                     {
                                         FinallyNormalName: "There aint no place like home",
                                         ReadonlyProperty: "blah",
                                         aay: [], ag: [], ao: [], as: [],
                                         ay: "QUJDYWJjAA==",
                                         b: false, d: 43, g: "", i: 0, n: 0,
                                         o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                                         y: 42
                                     }, "correct data");
                    dbus.removeEventListener("notify", onnotify);
                    done();
                });
    });

    QUnit.test("watch object manager", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch({ path_namespace: "/otree" })
                .done(function() {
                    assert.deepEqual(cache, {
                        "/otree/frobber": {
                            "com.redhat.Cockpit.DBusTests.Frobber":
                          {
                              FinallyNormalName: "There aint no place like home",
                              ReadonlyProperty: "blah",
                              aay: [], ag: [], ao: [], as: [],
                              ay: "QUJDYWJjAA==",
                              b: false, d: 43, g: "", i: 0, n: 0,
                              o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                              y: 42
                          }
                        }
                    }, "correct data");
                    dbus.removeEventListener("notify", onnotify);
                    done();
                });
    });

    QUnit.test("watch change", assert => {
        const done = assert.async();
        assert.expect(2);

        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify_cache = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify_cache);

        const onnotify_test = (event, data) => {
            assert.equal(typeof cache["/otree/frobber"], "object", "has path");
            assert.deepEqual(cache, {
                "/otree/frobber": {
                    "com.redhat.Cockpit.DBusTests.Frobber": {
                        FinallyNormalName: "There aint no place like home",
                        ReadonlyProperty: "blah",
                        aay: [], ag: [], ao: [], as: [],
                        ay: "QUJDYWJjAA==",
                        b: false, d: 43, g: "", i: 0, n: 0,
                        o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                        y: 42
                    }
                }
            }, "correct data");
            dbus.removeEventListener("notify", onnotify_cache);
            dbus.removeEventListener("notify", onnotify_test);
        };
        dbus.addEventListener("notify", onnotify_test);

        dbus.watch("/otree/frobber")
                .then(() => done());
    });

    QUnit.test("watch barrier", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch({ path_namespace: "/otree" });

        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"])
                .done(function(reply) {
                    assert.deepEqual(cache["/otree/frobber"]["com.redhat.Cockpit.DBusTests.Frobber"],
                                     {
                                         FinallyNormalName: "There aint no place like home",
                                         ReadonlyProperty: "blah",
                                         aay: [], ag: [], ao: [], as: [],
                                         ay: "QUJDYWJjAA==",
                                         b: false, d: 43, g: "", i: 0, n: 0,
                                         o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                                         y: 42
                                     }, "correct data");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "finished successfully");
                    dbus.removeEventListener("notify", onnotify);
                    done();
                });
    });

    QUnit.test("watch interfaces", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => deep_update(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch({ path_namespace: "/otree" })
                .done(function() {
                    assert.deepEqual(cache, {
                        "/otree/frobber": {
                            "com.redhat.Cockpit.DBusTests.Frobber":
                          {
                              FinallyNormalName: "There aint no place like home",
                              ReadonlyProperty: "blah",
                              aay: [], ag: [], ao: [], as: [],
                              ay: "QUJDYWJjAA==",
                              b: false, d: 43, g: "", i: 0, n: 0,
                              o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                              y: 42
                          }
                        }
                    }, "correct data");
                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "AddAlpha", [])
                            .done(function () {
                                assert.deepEqual(cache, {
                                    "/otree/frobber": {
                                        "com.redhat.Cockpit.DBusTests.Frobber":
                                  {
                                      FinallyNormalName: "There aint no place like home",
                                      ReadonlyProperty: "blah",
                                      aay: [], ag: [], ao: [], as: [],
                                      ay: "QUJDYWJjAA==",
                                      b: false, d: 43, g: "", i: 0, n: 0,
                                      o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                                      y: 42
                                  },
                                        "com.redhat.Cockpit.DBusTests.Alpha": {}
                                    }
                                }, "correct data");
                                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "RemoveAlpha", [])
                                        .done(function () {
                                            assert.deepEqual(cache, {
                                                "/otree/frobber": {
                                                    "com.redhat.Cockpit.DBusTests.Frobber":
                                      {
                                          FinallyNormalName: "There aint no place like home",
                                          ReadonlyProperty: "blah",
                                          aay: [], ag: [], ao: [], as: [],
                                          ay: "QUJDYWJjAA==",
                                          b: false, d: 43, g: "", i: 0, n: 0,
                                          o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                                          y: 42
                                      },
                                                    "com.redhat.Cockpit.DBusTests.Alpha": null
                                                }
                                            }, "correct data");
                                            dbus.removeEventListener("notify", onnotify);
                                            done();
                                        });
                            });
                });
    });

    QUnit.test.butNotForPy("path loop", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const name = "yo" + new Date().getTime();
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => Object.assign(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch({ path_namespace: "/cliques/" + name })
                .done(function() {
                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                              "CreateClique", [name])
                            .done(function(path) {
                                const expect = { };
                                /* The same way mock-service.c calculates the paths */
                                for (let i = 0; i < 3; i++) {
                                    expect["/cliques/" + name + "/" + i] = {
                                        "com.redhat.Cockpit.DBusTests.Clique": {
                                            Friend: "/cliques/" + name + "/" + (i + 1) % 3
                                        }
                                    };
                                }
                                assert.deepEqual(cache, expect, "got all data before method reply");
                            })
                            .always(function() {
                                assert.equal(this.state(), "resolved", "method called");
                                dbus.removeEventListener("notify", onnotify);
                                done();
                            });
                });
    });

    QUnit.test.butNotForPy("path signal", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const name = "yo" + new Date().getTime();
        const cache = { };

        const dbus = cockpit.dbus(bus_name, channel_options);
        const onnotify = (event, data) => Object.assign(cache, data);
        dbus.addEventListener("notify", onnotify);

        dbus.watch({ path: "/hidden/" + name })
                .done(function() {
                    assert.deepEqual(cache, { }, "no data yet");

                    dbus.subscribe({ path: "/hidden/" + name }, function(path, iface, args) {
                        assert.equal(typeof cache[path], "object", "have object");
                        assert.deepEqual(cache[path], {
                            "com.redhat.Cockpit.DBusTests.Hidden": { Name: name }
                        }, "got data before signal");
                        dbus.removeEventListener("notify", onnotify);
                    });
                    dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                              "EmitHidden", [name])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "method called");
                                done();
                            });
                });
    });

    QUnit.test("proxy", function (assert) {
        const done = assert.async();
        assert.expect(7);

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
        proxy.wait(function() {
            assert.strictEqual(proxy.valid, true, "proxy: is valid");
            assert.deepEqual(proxy.data, {
                FinallyNormalName: "There aint no place like home",
                ReadonlyProperty: "blah",
                aay: [], ag: [], ao: [], as: [],
                ay: "QUJDYWJjAA==",
                b: false, d: 43, g: "", i: 0, n: 0,
                o: "/", q: 0, s: "", t: 0, u: 0, x: 0,
                y: 42
            }, "correct data");

            assert.strictEqual(proxy.FinallyNormalName, "There aint no place like home", "property value");
            assert.strictEqual(proxy.ReadonlyProperty, "blah", "another property value");

            assert.equal(typeof proxy.HelloWorld, "function", "has function defined");
            proxy.HelloWorld("From a proxy")
                    .done(function(message) {
                        assert.equal(message, "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
                    })
                    .always(function() {
                        assert.equal(this.state(), "resolved", "method called");
                        done();
                    });
        });
    });

    QUnit.test("proxy call", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        /* No wait */
        proxy.call("HelloWorld", ["From a proxy"])
                .done(function(args) {
                    assert.equal(args[0], "Word! You said `From a proxy'. I'm Skeleton, btw!", "method args");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "method called");
                    done();
                });
    });

    QUnit.test.butNotForPy("proxy call with timeout", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        proxy.call('NeverReturn', [], { timeout: 10 })
                .fail(function (ex) {
                    assert.equal(ex.name, "org.freedesktop.DBus.Error.Timeout");
                })
                .always(function() {
                    assert.equal(this.state(), "rejected", "call timed out");
                    done();
                });
    });

    QUnit.test("proxy signal", function (assert) {
        const done = assert.async();
        assert.expect(4);

        let received = false;

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        const onsignal = (event, name, args) => {
            assert.equal(name, "TestSignal", "signals: got right name");
            assert.deepEqual(args, [
                43, ["foo", "frobber"], ["/foo", "/foo/bar"],
                { first: [42, 42], second: [43, 43] }], "got right arguments");
            received = true;
        };
        proxy.addEventListener("signal", onsignal);

        proxy.call("RequestSignalEmission", [0])
                .always(function() {
                    assert.equal(this.state(), "resolved", "emission requested");
                    assert.equal(received, true, "signal received");
                    proxy.removeEventListener("signal", onsignal);
                    done();
                });
    });

    QUnit.test("proxy explicit notify", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus(bus_name, channel_options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");

        proxy.wait().done(function() {
            const onchanged = () => {
                assert.equal(proxy.FinallyNormalName, "externally injected");
                proxy.removeEventListener("changed", onchanged);
                done();
            };
            proxy.addEventListener("changed", onchanged);

            dbus.notify({
                "/otree/frobber": {
                    "com.redhat.Cockpit.DBusTests.Frobber": {
                        FinallyNormalName: "externally injected"
                    }
                }
            });
        });
    });

    QUnit.test("proxies", function (assert) {
        const done = assert.async();
        assert.expect(13);

        const dbus = cockpit.dbus(bus_name, channel_options);

        /* Just some cleanup */
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "DeleteAllObjects", [])
                .always(function() {
                    assert.equal(this.state(), "resolved", "deleted stray objects");

                    const proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber", "/otree");
                    proxies.wait().always(function() {
                        let added;
                        proxies.addEventListener("added", function(event, proxy) {
                            added = proxy;
                            assert.strictEqual(added.valid, true, "added objects valid");
                        });

                        let changed;
                        proxies.addEventListener("changed", function(event, proxy) {
                            changed = proxy;
                        });

                        let removed;
                        proxies.addEventListener("removed", function(event, proxy) {
                            removed = proxy;
                        });

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "CreateObject", ["/otree/other"])
                                .always(function() {
                                    assert.equal(this.state(), "resolved", "create objects done");

                                    assert.equal(typeof added, "object", "got added object");
                                    assert.equal(typeof changed, "object", "no changed object yet");
                                    assert.equal(typeof removed, "undefined", "no removed object yet");
                                    assert.equal(added.path, "/otree/other", "added object correct");
                                    assert.strictEqual(added, changed, "added fires changed");

                                    changed = null;

                                    dbus.call(added.path, added.iface, "RequestPropertyMods", [])
                                            .always(function() {
                                                assert.equal(this.state(), "resolved", "changed object");
                                                assert.strictEqual(changed, added, "change fired");

                                                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                                          "DeleteObject", ["/otree/other"])
                                                        .always(function() {
                                                            assert.equal(this.state(), "resolved", "removed object");
                                                            assert.strictEqual(removed, added, "removed fired");
                                                            assert.strictEqual(removed.valid, false, "removed is invalid");
                                                            dbus.close();
                                                            done();
                                                        });
                                            });
                                });
                    });
                });
    });
}

export function dbus_track_tests(channel_options, bus_name) { // eslint-disable-line no-unused-vars
    QUnit.test.butNotForPy("track name", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const name = "yo.x" + new Date().getTime();
        let released = false;
        let gone = false;

        const dbus = cockpit.dbus(bus_name, channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [name])
                .always(function() {
                    assert.equal(this.state(), "resolved", "name claimed");

                    const other = cockpit.dbus(name, {
                        bus: channel_options.bus,
                        address: channel_options.address,
                        track: true
                    });
                    other.addEventListener("close", function(event, data) {
                        assert.strictEqual(data.problem, undefined, "no problem");
                        gone = true;
                        if (released && gone)
                            done();
                    });

                    other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                               "HelloWorld", ["test"])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "called on other name");

                                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                          "ReleaseOtherName", [name])
                                        .always(function() {
                                            assert.equal(this.state(), "resolved", "name released");
                                            released = true;
                                            if (released && gone)
                                                done();
                                        });
                            });
                });
    });

    QUnit.test("no track name", function (assert) {
        const done = assert.async();
        assert.expect(5);

        const name = "yo.y" + new Date().getTime();
        let gone = false;

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "ClaimOtherName", [name])
                .always(function() {
                    assert.equal(this.state(), "resolved", "name claimed");

                    const other = cockpit.dbus(name, channel_options);
                    other.addEventListener("close", function(event, data) {
                        gone = true;
                    });

                    other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                               "HelloWorld", ["test"])
                            .always(function() {
                                assert.equal(this.state(), "resolved", "called on other name");

                                dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                          "ReleaseOtherName", [name])
                                        .always(function() {
                                            assert.equal(this.state(), "resolved", "name released");

                                            other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                                       "HelloWorld", ["test"])
                                                    .always(function() {
                                                        assert.equal(this.state(), "rejected", "call after release should fail");
                                                        assert.equal(gone, false, "is not gone");
                                                        done();
                                                    });
                                        });
                            });
                });
    });

    QUnit.test.butNotForPy("receive readable fd", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "MakeTestFd", ["readable"])
                .done(function (reply) {
                    const fd = reply[0];
                    assert.equal(typeof (fd.internal), 'string');
                    assert.equal(fd.payload, 'stream');

                    const channel = cockpit.channel(fd);

                    const messageReceived = assert.async();
                    channel.onmessage = function (event, data) {
                        assert.equal(data, 'Hello, fd');
                        channel.close();
                        messageReceived();
                    };
                })
                .always(function () {
                    assert.equal(this.state(), "resolved", "fd received");
                    done();
                });
    });

    QUnit.test.butNotForPy("receive readable fd and ensure opening more than once fails", function (assert) {
        const done = assert.async();
        assert.expect(7);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "MakeTestFd", ["readable"])
                .done(function (reply) {
                    const fd = reply[0];
                    assert.equal(typeof (fd.internal), 'string');
                    assert.equal(fd.payload, 'stream');

                    const channel1 = cockpit.channel(fd);
                    assert.ok(channel1);
                    const channel2 = cockpit.channel(fd);

                    const closed = assert.async();
                    channel2.onclose = function (event, options) {
                        assert.equal(options.channel, channel2.id);
                        assert.equal(options.command, 'close');
                        assert.equal(options.problem, 'not-found');
                        closed();
                    };
                })
                .always(function () {
                    assert.equal(this.state(), "resolved", "fd received");
                    done();
                });
    });

    QUnit.test.butNotForPy("receive readable fd and ensure writing fails", function (assert) {
        const done = assert.async();
        assert.expect(6);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "MakeTestFd", ["readable"])
                .done(function (reply) {
                    const fd = reply[0];
                    assert.equal(typeof (fd.internal), 'string');
                    assert.equal(fd.payload, 'stream');

                    const channel = cockpit.channel(fd);
                    channel.send('Hello, fd');

                    const closed = assert.async();
                    channel.onclose = function (event, options) {
                        assert.equal(options.channel, channel.id);
                        assert.equal(options.command, 'close');
                        assert.equal(options.problem, 'protocol-error');
                        closed();
                    };
                })
                .always(function () {
                    assert.equal(this.state(), "resolved", "fd received");
                    done();
                });
    });

    QUnit.test.butNotForPy("receive writable fd", function (assert) {
        const done = assert.async();
        assert.expect(3);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", channel_options);
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "MakeTestFd", ["writable"])
                .done(function (reply) {
                    const fd = reply[0];
                    assert.equal(typeof (fd.internal), 'string');
                    assert.equal(fd.payload, 'stream');

                    const channel = cockpit.channel(fd);
                    channel.send('Hello, fd');
                    channel.close();
                })
                .always(function () {
                    assert.equal(this.state(), "resolved", "fd received and not writable");
                    done();
                });
    });
}

export function extra_dbus_tests() {
    QUnit.test("proxy no stutter", function (assert) {
        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });

        const proxy = dbus.proxy();
        assert.equal(proxy.iface, "com.redhat.Cockpit.DBusTests.Test", "interface auto chosen");
        assert.equal(proxy.path, "/com/redhat/Cockpit/DBusTests/Test", "path auto chosen");
    });

    QUnit.test("proxies no stutter", function (assert) {
        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });

        const proxies = dbus.proxies();
        assert.equal(proxies.iface, "com.redhat.Cockpit.DBusTests.Test", "interface auto chosen");
        assert.equal(proxies.path_namespace, "/", "path auto chosen");
    });

    QUnit.test("exposed client and options", function (assert) {
        const options = { host: "localhost", bus: "session" };
        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", options);
        const proxy = dbus.proxy("com.redhat.Cockpit.DBusTests.Frobber", "/otree/frobber");
        const proxies = dbus.proxies("com.redhat.Cockpit.DBusTests.Frobber");

        assert.deepEqual(dbus.options, options, "client object exposes options");
        assert.strictEqual(proxy.client, dbus, "proxy object exposes client");
        assert.strictEqual(proxies.client, dbus, "proxies object exposes client");
    });

    QUnit.test("subscriptions on closed client", function (assert) {
        function on_signal() {
        }

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
        dbus.close();

        const subscription = dbus.subscribe({
            interface: "com.redhat.Cockpit.DBusTests.Frobber",
            path: "/otree/frobber"
        }, on_signal);
        assert.ok(subscription, "can subscribe");

        subscription.remove();
        assert.ok(true, "can unsubscribe");
    });

    QUnit.test("watch promise recursive", function (assert) {
        assert.expect(7);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
        const promise = dbus.watch("/otree/frobber");

        const target = { };
        const promise2 = promise.promise(target);
        assert.strictEqual(promise2, target, "used target");
        assert.equal(typeof promise2.done, "function", "promise2.done()");
        assert.equal(typeof promise2.promise, "function", "promise2.promise()");
        assert.equal(typeof promise2.remove, "function", "promise2.remove()");

        const promise3 = promise2.promise();
        assert.equal(typeof promise3.done, "function", "promise3.done()");
        assert.equal(typeof promise3.promise, "function", "promise3.promise()");
        assert.equal(typeof promise3.remove, "function", "promise3.remove()");
    });

    QUnit.test.butNotForPy("owned messages", function (assert) {
        const done = assert.async();
        assert.expect(9);

        const name = "yo.x" + new Date().getTime();
        let times_changed = 0;

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
        let other = null;
        let org_owner = null;
        function on_owner (event, owner) {
            if (times_changed === 0) {
                assert.strictEqual(typeof owner, "string", "initial owner string");
                assert.ok(owner.length > 1, "initial owner not empty");
                org_owner = owner;
            } else if (times_changed === 1) {
                assert.strictEqual(owner, null, "no owner");
            } else if (times_changed === 2) {
            // owner is the same because the server
            // dbus connection is too.
                assert.strictEqual(owner, org_owner, "has owner again");
            }
            times_changed++;
        }

        function acquire_name () {
            dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                      "ClaimOtherName", [name])
                    .always(function() {
                        assert.equal(this.state(), "resolved", "name claimed");
                        if (!other) {
                            other = cockpit.dbus(name, { bus: "session" });
                            other.addEventListener("owner", on_owner);
                            release_name();
                        } else {
                            assert.strictEqual(times_changed, 3, "owner changed three times");
                            done();
                        }
                    });
        }

        function release_name () {
            other.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                       "HelloWorld", ["test"])
                    .always(function() {
                        assert.equal(this.state(), "resolved", "called on other name");

                        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                                  "ReleaseOtherName", [name])
                                .always(function() {
                                    assert.equal(this.state(), "resolved", "name released");
                                    acquire_name();
                                });
                    });
        }
        acquire_name();
    });

    QUnit.test.butNotForPy("bad dbus address", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus(null, { bus: "none", address: "bad" });
        dbus.addEventListener("close", (event, options) => {
            assert.equal(options.problem, "protocol-error", "bad address closed");
            done();
        });
    });

    QUnit.test.butNotForPy("bad dbus bus", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus(null, { bus: "bad" });
        dbus.addEventListener("close", (event, options) => {
            assert.equal(options.problem, "protocol-error", "bad bus format");
            done();
        });
    });

    QUnit.test.butNotForPy("wait ready", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
        dbus.wait().then(function(options) {
            assert.ok(!!dbus.unique_name, "wait fills unique_name");
        }, function() {
            assert.ok(false, "shouldn't fail");
        })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("wait fail", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus(null, { bus: "none", address: "bad" });
        dbus.wait().then(function(options) {
            assert.ok(false, "shouldn't succeed");
        }, function() {
            assert.ok(true, "should fail");
        })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("no default name", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"], { name: "com.redhat.Cockpit.DBusTests.Test" })
                .then(function(reply) {
                    assert.deepEqual(reply, ["Word! You said `Browser-side JS'. I'm Skeleton, btw!"], "replied");
                }, function(ex) {
                    assert.ok(false, "shouldn't fail");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("no default name bad", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"], { name: 5 })
                .then(function(reply) {
                    assert.ok(false, "shouldn't succeed");
                }, function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error problem");
                    assert.equal(ex.message, "the \"name\" field is invalid in dbus call", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("no default name invalid", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"], { name: "!invalid!" })
                .then(function(reply) {
                    assert.ok(false, "shouldn't succeed");
                }, function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error problem");
                    assert.equal(ex.message, "the \"name\" field in dbus call is not a valid bus name: !invalid!", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("no default name missing", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                  "HelloWorld", ["Browser-side JS"])
                .then(function(reply) {
                    assert.ok(false, "shouldn't succeed");
                }, function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error problem");
                    assert.equal(ex.message, "the \"name\" field is missing in dbus call", "error message");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("no default name second", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [],
                  { name: "com.redhat.Cockpit.DBusTests.Test" })
                .then(function(reply) {
                    assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Test"], "right name");
                    return dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [],
                                     { name: "com.redhat.Cockpit.DBusTests.Second" })
                            .then(function(reply) {
                                assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Second"], "second name");
                            }, function(ex) {
                                assert.ok(false, "shouldn't fail");
                            });
                }, function(ex) {
                    console.log(ex);
                    assert.ok(false, "shouldn't fail");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("override default name", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { bus: "session" });
        dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [])
                .then(function(reply) {
                    assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Test"], "right name");
                    return dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber", "TellMeYourName", [],
                                     { name: "com.redhat.Cockpit.DBusTests.Second" })
                            .then(function(reply) {
                                assert.deepEqual(reply, ["com.redhat.Cockpit.DBusTests.Second"], "second name");
                            }, function(ex) {
                                assert.ok(false, "shouldn't fail");
                            });
                }, function(ex) {
                    console.log(ex);
                    assert.ok(false, "shouldn't fail");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test.butNotForPy("watch no default name", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const cache = { };

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.addEventListener("notify", function(event, data) {
            Object.assign(cache, data);
        });

        dbus.watch({ path: "/otree/frobber", name: "com.redhat.Cockpit.DBusTests.Second" })
                .then(function() {
                    assert.equal(typeof cache["/otree/frobber"], "object", "has path");
                }, function(ex) {
                    assert.ok(false, "shouldn't fail");
                })
                .always(function() {
                    dbus.close();
                    done();
                });
    });

    QUnit.test.butNotForPy("watch missing name", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(null, { bus: "session", other: "option" });
        dbus.watch("/otree/frobber")
                .then(function() {
                    assert.ok(false, "shouldn't succeed");
                }, function(ex) {
                    assert.equal(ex.problem, "protocol-error", "error problem");
                    assert.equal(ex.message, "session: no \"name\" specified in match", "error message");
                })
                .always(function() {
                    dbus.close();
                    done();
                });
    });

    QUnit.test.butNotForPy("shared client", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus1 = cockpit.dbus(null, { bus: "session" });
        const dbus2 = cockpit.dbus(null, { bus: "session" });

        /* Is identical */
        assert.strictEqual(dbus1, dbus2, "shared bus returned");

        /* Closing shouldn't close shared */
        dbus1.close();

        dbus2.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                   "HelloWorld", ["Browser-side JS"], { name: "com.redhat.Cockpit.DBusTests.Test" })
                .then(function(reply) {
                    assert.deepEqual(reply, ["Word! You said `Browser-side JS'. I'm Skeleton, btw!"],
                                     "call still works");
                }, function(ex) {
                    assert.ok(false, "shouldn't fail");
                })
                .always(function() {
                    done();
                });
    });

    QUnit.test("not shared option", function (assert) {
        assert.expect(1);

        const dbus1 = cockpit.dbus(null, { bus: "session" });
        const dbus2 = cockpit.dbus(null, { bus: "session", other: "option" });

        /* Should not be identical */
        assert.notStrictEqual(dbus1, dbus2, "shared bus returned");

        /* Closing shouldn't close shared */
        dbus1.close();
        dbus2.close();
    });

    QUnit.test.butNotForPy("emit signal meta", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const meta = {
            "borkety.Bork": {
                signals: {
                    Bork: {
                        in: ["i", "i", "i", "i", "s"]
                    }
                }
            }
        };

        let received = false;
        const dbus = cockpit.dbus(null, { bus: "session", other: "option" });
        dbus.meta(meta);
        dbus.wait(function() {
            dbus.subscribe({ path: "/bork", name: dbus.unique_name }, function(path, iface, signal, args) {
                assert.equal(path, "/bork", "reflected path");
                assert.equal(iface, "borkety.Bork", "reflected interface");
                assert.equal(signal, "Bork", "reflected signal");
                assert.deepEqual(args, [1, 2, 3, 4, "Bork"], "reflected arguments");
                received = true;
                dbus.close();
                done();
            });

            dbus.addEventListener("close", function(event, ex) {
                if (!received) {
                    console.log(ex);
                    assert.ok(false, "shouldn't fail");
                    done();
                }
            });

            dbus.signal("/bork", "borkety.Bork", "Bork", [1, 2, 3, 4, "Bork"],
                        { type: "iiiis" });
        });
    });

    QUnit.test.butNotForPy("emit signal type", function (assert) {
        const done = assert.async();
        assert.expect(4);

        let received = false;
        const dbus = cockpit.dbus(null, { bus: "session", other: "option" });
        dbus.wait(function() {
            dbus.subscribe({ path: "/bork", name: dbus.unique_name }, function(path, iface, signal, args) {
                assert.equal(path, "/bork", "reflected path");
                assert.equal(iface, "borkety.Bork", "reflected interface");
                assert.equal(signal, "Bork", "reflected signal");
                assert.deepEqual(args, [1, 2, 3, 4, "Bork"], "reflected arguments");
                received = true;
                dbus.close();
                done();
            });

            dbus.addEventListener("close", function(event, ex) {
                if (!received) {
                    console.log(ex);
                    assert.ok(false, "shouldn't fail");
                    done();
                }
            });

            dbus.signal("/bork", "borkety.Bork", "Bork", [1, 2, 3, 4, "Bork"],
                        { type: "iiiis" });
        });
    });

    QUnit.test.butNotForPy("emit signal no meta", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const dbus = cockpit.dbus(null, { bus: "session", other: "option" });

        function closed(event, ex) {
            assert.equal(ex.problem, "protocol-error", "correct problem");
            assert.equal(ex.message, "signal argument types for signal borkety.Bork Bork unknown", "correct message");
            dbus.removeEventListener("close", closed);
            dbus.close();
            done();
        }

        dbus.addEventListener("close", closed);
        dbus.signal("/bork", "borkety.Bork", "Bork", [1, 2, 3, 4, "Bork"]);
    });

    QUnit.test.butNotForPy("publish object", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const info = {
            "org.Interface": {
                methods: {
                    Add: { in: ["i", "i"], out: ["s"] },
                    Live: { in: ["s"] },
                }
            }
        };

        let received = null;

        const object = {
            Add: function(one, two) {
                return String(one + two);
            },
            Live: function(input) {
                received = input;
            }
        };

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.meta(info);
        dbus.wait().then(function() {
            const published = dbus.publish("/a/path", "org.Interface", object);

            published.then(function() {
                assert.ok(true, "should resolve");
            }, function() {
                assert.ok(!true, "should not have failed");
            });

            /* Note that we're calling ourselves, but via the bus */
            dbus.call("/a/path", "org.Interface", "Live", ["marmalade"], { name: dbus.unique_name });
            dbus.call("/a/path", "org.Interface", "Add", [3, 44], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.ok(published, "object was published");
                        assert.deepEqual(reply, ["47"], "got back right reply");
                        assert.strictEqual(received, "marmalade", "received right arguments");
                    }, function(ex) {
                        assert.ok(false, "should not have failed");
                    })
                    .always(function() {
                        dbus.close();
                        done();
                    });
        });
    });

    QUnit.test.butNotForPy("publish object promise", function (assert) {
        const done = assert.async();
        assert.expect(1);

        const info = {
            "org.Interface": {
                methods: {
                    Add: { in: ["i", "i"], out: ["s", "i", "i"] },
                }
            }
        };

        const object = {
            Add: function(one, two) {
                const defer = cockpit.defer();
                window.setTimeout(function() {
                    defer.resolve(String(one + two), one, two);
                }, 200);
                return defer.promise;
            }
        };

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.meta(info);
        dbus.wait().then(function() {
            dbus.publish("/a/path", "org.Interface", object);

            /* Note that we're calling ourselves, but via the bus */
            dbus.call("/a/path", "org.Interface", "Add", [3, 44], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.deepEqual(reply, ["47", 3, 44], "got back right reply");
                    }, function(ex) {
                        assert.ok(false, "should not have failed");
                    })
                    .always(function() {
                        dbus.close();
                        done();
                    });
        });
    });

    QUnit.test.butNotForPy("publish object failure", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const info = {
            "org.Interface": {
                methods: {
                    Fails: { in: ["i", "i"], out: ["s", "i", "i"] },
                }
            }
        };

        const object = {
            Fails: function(one, two) {
                const defer = cockpit.defer();
                const ex = new Error("this is the message");
                ex.name = "org.Error";
                window.setTimeout(function() {
                    defer.reject(ex);
                }, 5);
                return defer.promise;
            }
        };

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.meta(info);
        dbus.wait().then(function() {
            dbus.publish("/a/path", "org.Interface", object);

            /* Note that we're calling ourselves, but via the bus */
            dbus.call("/a/path", "org.Interface", "Fails", [3, 44], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.ok(false, "should not have succeeded");
                    }, function(ex) {
                        assert.strictEqual(ex.name, "org.Error", "got right error name");
                        assert.strictEqual(ex.message, "this is the message", "got right error message");
                    })
                    .always(function() {
                        dbus.close();
                        done();
                    });
        });
    });

    QUnit.test.butNotForPy("publish object replaces", function (assert) {
        const done = assert.async();
        assert.expect(2);

        const info = {
            "org.Interface": {
                methods: {
                    Bonk: { in: ["s"], out: ["s"] },
                }
            }
        };

        const object1 = {
            Bonk: function(input) {
                return input + " bonked";
            }
        };

        const object2 = {
            Bonk: function(input) {
                return "nope not bonked";
            }
        };

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.meta(info);
        dbus.wait().then(function() {
            dbus.publish("/a/path", "org.Interface", object1);

            /* Note that we're calling ourselves, but via the bus */
            dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.deepEqual(reply, ["hi bonked"], "got back reply from first object");
                        dbus.publish("/a/path", "org.Interface", object2);
                        dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                                .then(function(reply) {
                                    assert.deepEqual(reply, ["nope not bonked"], "got back reply from second object");
                                }, function() {
                                    assert.ok(false, "should not have failed");
                                })
                                .always(function() {
                                    dbus.close();
                                    done();
                                });
                    }, function(ex) {
                        assert.ok(false, "should not have failed");
                    });
        });
    });

    QUnit.test.butNotForPy("publish object unpublish", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const info = {
            "org.Interface": {
                methods: {
                    Bonk: { in: ["s"], out: ["s"] },
                }
            }
        };

        const object = {
            Bonk: function(input) {
                return input + " bonked";
            }
        };

        const dbus = cockpit.dbus(null, { bus: "session" });
        dbus.meta(info);
        dbus.wait().then(function() {
            const published = dbus.publish("/a/path", "org.Interface", object);

            /* Note that we're calling ourselves, but via the bus */
            dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                    .then(function(reply) {
                        assert.deepEqual(reply, ["hi bonked"], "got back reply from first object");
                        published.remove();

                        dbus.call("/a/path", "org.Interface", "Bonk", ["hi"], { name: dbus.unique_name })
                                .then(function(reply) {
                                    assert.ok(false, "should not have succeeded");
                                }, function(ex) {
                                    assert.strictEqual(ex.name, "org.freedesktop.DBus.Error.UnknownMethod",
                                                       "got right error name");
                                    assert.ok(ex.message.includes("No such interface") ||
                                          ex.message.includes("Object does not exist"),
                                              "unexpected error: " + ex.message);
                                    assert.ok(ex.message.indexOf("/a/path") > 0, "unexpected error: " + ex.message);
                                })
                                .always(function() {
                                    dbus.close();
                                    done();
                                });
                    }, function(ex) {
                        assert.ok(false, "should not have failed");
                    });
        });
    });

    function internal_test(assert, options) {
        const done = assert.async();
        assert.expect(2);
        const dbus = cockpit.dbus(null, options);
        dbus.call("/", "org.freedesktop.DBus.Introspectable", "Introspect")
                .done(function(resp) {
                    assert.ok(String(resp[0]).indexOf("<node") !== -1, "introspected internal");
                })
                .always(function() {
                    assert.equal(this.state(), "resolved", "called internal");
                    done();
                });
    }

    QUnit.test("internal dbus", function (assert) {
        internal_test(assert, { bus: "internal" });
    });

    QUnit.test.butNotForPy("internal dbus bus none", function (assert) {
        internal_test(assert, { bus: "none" });
    });

    QUnit.test.butNotForPy("internal dbus bus none with address", function (assert) {
        internal_test(assert, { bus: "none", address: "internal" });
    });

    QUnit.test.butNotForPy("separate dbus connections for channel groups", function (assert) {
        const done = assert.async();
        assert.expect(4);

        const channel1 = cockpit.channel({ payload: 'dbus-json3', group: 'foo', bus: 'session' });
        const channel2 = cockpit.channel({ payload: 'dbus-json3', group: 'bar', bus: 'session' });
        const channel3 = cockpit.channel({ payload: 'dbus-json3', group: 'foo', bus: 'session' });
        const channel4 = cockpit.channel({ payload: 'dbus-json3', group: 'baz', bus: 'session' });

        Promise.all([
            channel1.wait(), channel2.wait(), channel3.wait(), channel4.wait()
        ]).then(function ([ready1, ready2, ready3, ready4]) {
            assert.equal(ready1['unique-name'], ready3['unique-name']);
            assert.notEqual(ready1['unique-name'], ready2['unique-name']);
            assert.notEqual(ready1['unique-name'], ready4['unique-name']);
            assert.notEqual(ready2['unique-name'], ready4['unique-name']);
            done();
        });
    });

    QUnit.test.butNotForPy("cockpit.Config internal D-Bus API", function (assert) {
        const done = assert.async();
        assert.expect(6);

        const dbus = cockpit.dbus(null, { bus: "internal" });
        let configDir;
        let proxy;

        // Get temp config dir to see where to place our test config
        dbus.call("/environment", "org.freedesktop.DBus.Properties", "Get", ["cockpit.Environment", "Variables"])
                .then(reply => {
                    configDir = reply[0].v.XDG_CONFIG_DIRS;
                    return cockpit.file(configDir + "/cockpit/cockpit.conf").replace(`
[SomeSection]
SomeA = one
SomethingElse = 2

[Other]
Flavor=chocolate
Empty=
`);
                })
                .then(() => {
                    proxy = dbus.proxy("cockpit.Config", "/config");
                    return proxy.wait();
                })
        // the above changes the config after bridge startup, so reload
                .then(() => proxy.Reload())

        // test GetString()
                .then(() => proxy.GetString("SomeSection", "SomeA"))
                .then(result => {
                    assert.equal(result, "one");
                    return proxy.GetString("Other", "Empty");
                })

        // test GetUInt()
                .then(result => {
                    assert.equal(result, "");
                    // this key exists, ignores default
                    return proxy.GetUInt("SomeSection", "SomethingElse", 10, 100, 0);
                })
                .then(result => {
                    assert.equal(result, 2);
                    // this key does not exist, return default
                    return proxy.GetUInt("SomeSection", "NotExisting", 10, 100, 0);
                })
                .then(result => {
                    assert.equal(result, 10);
                    // out of bounds, clamp to minimum
                    return proxy.GetUInt("SomeSection", "SomethingElse", 42, 50, 5);
                })
                .catch(err => console.error("unexpected error:", JSON.stringify(err)))

                .then(result => {
                    assert.equal(result, 5);

                    // test GetString with non-existing section/key
                    assert.rejects(proxy.GetString("SomeSection", "UnknownKey"),
                                   /key.*UnknownKey.*not exist/,
                                   "unknown key raises an error");
                })
                .finally(done);
    });
}
