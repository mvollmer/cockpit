import QUnit from "qunit-tests";

import { common_dbus_tests, dbus_track_tests, extra_dbus_tests } from "./test-dbus-common.js";

QUnit.mock_info("bridge").then(bridge => {
    if (bridge == "cockpit-bridge.pyz")
        QUnit.test.butNotForPy = QUnit.test.skip;
    else
        QUnit.test.butNotForPy = QUnit.test;

    /* with a name */
    const options = {
        bus: "session"
    };

    common_dbus_tests(options, "com.redhat.Cockpit.DBusTests.Test");
    dbus_track_tests(options, "com.redhat.Cockpit.DBusTests.Test");
    extra_dbus_tests();

    QUnit.start();
});
