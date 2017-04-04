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
var _ = cockpit.gettext;

var $ = require("jquery");
var React = require("react");
var left_click = require("./utils.js").left_click;

var service = require("service");
var journal = require("journal");

var Service = React.createClass({
    getInitialState: function () {
        return { proxy: service.proxy(this.props.service) };
    },
    onServiceChanged: function () {
        this.setState({ });
    },
    componentDidMount: function () {
        $(this.state.proxy).on("changed", this.onServiceChanged);
    },
    componentWillUnmount: function () {
        $(this.state.proxy).off("changed", this.onServiceChanged);
    },

    render: function () {
        var self = this;
        var desc;
        if (this.state.proxy.unit)
            desc = this.state.proxy.unit.Description;
        if (!desc)
            desc = this.props.service;

        function start() {
            self.state.proxy.start();
        }

        function stop() {
            self.state.proxy.stop();
        }

        return (
            <div>
                {desc} {this.state.proxy.state}
                <div>
                    <button className="btn btn-default" onClick={left_click(start)}>{_("Start")}</button>
                    <button className="btn btn-default" onClick={left_click(stop)}>{_("Stop")}</button>
                </div>
            </div>
        );
    }
});

var Logs = React.createClass({
    getInitialState: function () {
        var self = this;
        var match = [ ];
        this.props.units.forEach(function (u) {
            match.push("_SYSTEMD_UNIT=" + u);
            match.push("+");
            match.push("UNIT=" + u);
            match.push("+");
        });
        match.pop();
        var ctl = journal.journalctl(match);
        ctl.stream(function (entries) {
            var state = self.state.entries;
            entries.forEach(function (e) {
                state.unshift(e["SYSLOG_IDENTIFIER"] + ": " + e["MESSAGE"]);
            });
            self.setState({ entries: state });
        });
        return { ctl: ctl, entries: [ ] };
    },
    render: function () {
        return (
            <div>
                { this.state.entries.map(function (e) { return <div>{e}</div>; }) }
            </div>
        );
    }
});

var Services = React.createClass({
    render: function () {
        if (this.props.services.length === 0)
            return null;

        return (
            <div>
                <h1>{this.props.title}</h1>
                { this.props.services.map(function (s) {
                     return <Service service={s.name}/>;
                  })
                }
                <h1>{_("Logs")}</h1>
                <Logs units={this.props.services.map(function (s) { return s.name; })}/>
            </div>
        );
    }
});

var ApplicationUI = React.createClass({
    render: function () {
        var metainfo = this.props.metainfo;

        if (!metainfo)
            return null;

        var services = metainfo.launchables.filter(function (l) { return l.type == "service"; });

        if (services.lengh == 0)
            return null;

        return <Services title={metainfo.name} services={services}/>;
    }
});

module.exports = {
    ApplicationUI: ApplicationUI
};
