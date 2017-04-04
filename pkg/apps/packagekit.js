/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

var cockpit = require("cockpit");
var $ = require("jquery");

// var _ = cockpit.gettext;

var client = cockpit.dbus("org.freedesktop.PackageKit");

// var transactions = client.proxies("org.freedesktop.PackageKit.Transaction");

// function show_transactions() {
//     for (var p in transactions)
//         console.log(p, transactions[p].LastPackage);
// }

// $(transactions).on("added removed changed", show_transactions);

function transaction(method, args, progress_cb, package_cb) {
    var defer = cockpit.defer();

    client.call("/org/freedesktop/PackageKit", "org.freedesktop.PackageKit", "CreateTransaction", [ ]).
        done(function(path_result) {
            var tr = client.proxy("org.freedesktop.PackageKit.Transaction", path_result[0]);
            $(tr).on("changed", function () {
                if (progress_cb && tr.Percentage && tr.Percentage != 101)
                    progress_cb(tr.Percentage);
            });
            $(tr).on("ErrorCode", function (event, code, details) {
                defer.reject(details, code);
            });
            $(tr).on("Package", function (event, info, package_id, summary) {
                if (package_cb)
                    package_cb(info, package_id, summary);
            });
            $(tr).on("Finished", function (event, exit, runtime) {
                defer.resolve(exit);
            });
            tr.call(method, args).fail(function (error) {
                console.log("Error", error);
                defer.reject();
            });
        }).
        fail(function (error) {
            defer.reject(error);
        });

    return defer.promise();
}

function progress_reporter(base, range, callback) {
    var percentage = 0;

    if (callback)
        return function (perc) {
            if (perc != percentage) {
                percentage = perc;
                callback(base + percentage/100*range);
            }
        };
}

function resolve(filter, name, progress_cb) {
    var defer = cockpit.defer();
    var ids = [ ];

    function gather_package_cb(info, package_id) {
        ids.push(package_id);
    }

    transaction("Resolve", [ filter, [ name ] ], progress_cb, gather_package_cb).
        done(function () {
            if (ids.length == 1)
                defer.resolve(ids[0]);
            else
                defer.reject("ambigious", ids);
        }).
        fail(function (error) {
            defer.reject(error);
        });

    return defer.promise();
}

function reload_bridge_packages() {
    return cockpit.dbus(null, { bus: "internal" }).call("/packages", "cockpit.Packages", "Reload", [ ]);
}

var PK_FILTER_INSTALLED   = (1 << 2);
var PK_FILTER_NEWEST      = (1 << 16);
var PK_FILTER_ARCH        = (1 << 18);
var PK_FILTER_NOT_SOURCE  = (1 << 21);

function install(name, progress_cb) {
    return resolve(PK_FILTER_ARCH | PK_FILTER_NOT_SOURCE | PK_FILTER_NEWEST, name,
                   progress_reporter(0, 10, progress_cb)).
        then(function (pkgid) {
            return transaction("InstallPackages", [ 0, [ pkgid ] ], progress_reporter(10, 90, progress_cb)).
                then(reload_bridge_packages);
        });
}

function remove(name, progress_cb) {
    return resolve(PK_FILTER_INSTALLED, name, progress_reporter(0, 10, progress_cb)).
        then(function (pkgid) {
            return transaction("RemovePackages", [ 0, [ pkgid ], true, false ], progress_reporter(10, 90, progress_cb)).
                then(reload_bridge_packages);
        });
}

module.exports = {
    install: install,
    remove: remove
};
