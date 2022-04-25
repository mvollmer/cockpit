/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import './sosreport.scss';
import "polyfills";

import React, { useState, useContext } from "react";
import ReactDOM from "react-dom";
import {
    Alert,
    Button,
    CodeBlockCode,
    Modal,
    Card,
    CardBody,
    Page,
    PageSection,
    PageSectionVariants,
    Flex,
    Label,
    LabelGroup,
    Dropdown,
    DropdownItem,
    KebabToggle,
    Form,
    FormGroup,
    InputGroup,
    TextInput,
    Checkbox,
    CardHeader,
    CardTitle,
    CardActions,
    Text,
    TextVariants
} from "@patternfly/react-core";
import { EyeIcon, EyeSlashIcon } from '@patternfly/react-icons';

import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ListingTable } from "cockpit-components-table.jsx";

import cockpit from "cockpit";
import { superuser } from "superuser";
import { useObject, useEvent, useMockData } from "hooks";

import { SuperuserDialogs } from "../shell/superuser.jsx";

const _ = cockpit.gettext;

const ErrorHandlerContext = React.createContext();
const WithErrorHandler = ErrorHandlerContext.Provider;
const useErrorHandler = () => useContext(ErrorHandlerContext);

function sosLister() {
    const self = {
        ready: false,
        problem: null,
        reports: {}
    };

    cockpit.event_target(self);

    function emit_changed() {
        self.dispatchEvent("changed");
    }

    function parse_report_name(path) {
        const basename = path.replace(/.*\//, "");
        const archive_rx = /^(secured-)?sosreport-(.*)\.tar\.[^.]+(\.gpg)?$/;
        const m = basename.match(archive_rx);
        if (m) {
            let parts = m[2].split("-");
            let obfuscated = false;
            if (parts[parts.length - 1] == "obfuscated") {
                obfuscated = true;
                parts = parts.slice(0, -1);
            }
            let label = null;
            if (parts.length >= 6) {
                let start = 1;
                if (parts[start] == "cockpit")
                    start++;
                label = parts.slice(start, -4).join("-");
            }
            return {
                encrypted: !!m[1],
                obfuscated: obfuscated,
                host: parts[0],
                date: parts.slice(-4, -1).join("-"),
                label: label
            };
        }
    }

    function add_report(path) {
        const report = parse_report_name(path);
        if (report) {
            self.reports[path] = report;
            if (self.ready)
                emit_changed();
        }
    }

    function rem_report(path) {
        delete self.reports[path];
        emit_changed();
    }

    let watch = null;

    function restart() {
        if (superuser.allowed === null)
            return;

        if (watch)
            watch.close("cancelled");
        self.ready = false;
        self.problem = null;
        watch = cockpit.channel({ payload: "fslist1", path: "/var/tmp", superuser: true });
        watch.addEventListener("close", (event, message) => {
            self.problem = message.problem;
            self.ready = true;
            emit_changed();
        });
        watch.addEventListener("control", (event, payload) => {
            if (payload.command == "ready") {
                self.ready = true;
                emit_changed();
            }
        });
        watch.addEventListener("message", (event, payload) => {
            const msg = JSON.parse(payload);
            if (msg.event == "deleted")
                rem_report(msg.path);
            else if (msg.event == "present")
                add_report("/var/tmp/" + msg.path);
            else
                add_report(msg.path);
        });
    }

    restart();
    superuser.addEventListener("changed", restart);
    return self;
}

function sosCreate(args, setProgress, setError, setErrorDetail) {
    let output = "";
    let plugins_count = 0;
    const progress_regex = /Running ([0-9]+)\/([0-9]+):/; // Only for sos < 3.6
    const finishing_regex = /Finishing plugins.*\[Running: (.*)\]/;
    const starting_regex = /Starting ([0-9]+)\/([0-9]+).*\[Running: (.*)\]/;
    const archive_regex = /Your sosreport has been generated and saved in:\s+(\/[^\r\n]+)/;

    // TODO - Use a real API instead of scraping stdout once such an API exists
    const task = cockpit.spawn(["sos", "report", "--batch"].concat(args),
                               { superuser: true, err: "out", pty: true });

    task.archive_url = null;

    task.stream(text => {
        let p = 0;
        let m;

        output += text;
        const lines = output.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            if ((m = starting_regex.exec(lines[i]))) {
                plugins_count = parseInt(m[2], 10);
                p = ((parseInt(m[1], 10) - m[3].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = finishing_regex.exec(lines[i]))) {
                if (!plugins_count)
                    p = 100;
                else
                    p = ((plugins_count - m[1].split(" ").length) / plugins_count) * 100;
                break;
            } else if ((m = progress_regex.exec(lines[i]))) {
                p = (parseInt(m[1], 10) / parseInt(m[2], 10)) * 100;
                break;
            }
        }

        setProgress(p);
    });

    task.then(() => {
        const m = archive_regex.exec(output);
        if (m) {
            let archive = m[1];
            const basename = archive.replace(/.*\//, "");

            // When running sosreport in a container, the archive path needs to be adjusted
            //
            if (archive.indexOf("/host") === 0)
                archive = archive.substr(5);

            const query = window.btoa(JSON.stringify({
                payload: "fsread1",
                binary: "raw",
                path: archive,
                superuser: true,
                max_read_size: 150 * 1024 * 1024,
                external: {
                    "content-disposition": 'attachment; filename="' + basename + '"',
                    "content-type": "application/x-xz, application/octet-stream"
                }
            }));
            const prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
            task.archive_url = prefix + '?' + query;
            setProgress(100);
        } else {
            setError(_("No archive has been created."));
            setErrorDetail(output);
        }
    });

    task.catch(error => {
        setError(error.toString());
        setErrorDetail(output);
    });

    return task;
}

function sosDownload(path) {
    const basename = path.replace(/.*\//, "");
    const query = window.btoa(JSON.stringify({
        payload: "fsread1",
        binary: "raw",
        path: path,
        superuser: true,
        max_read_size: 150 * 1024 * 1024,
        external: {
            "content-disposition": 'attachment; filename="' + basename + '"',
            "content-type": "application/x-xz, application/octet-stream"
        }
    }));
    const prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
    const url = prefix + '?' + query;
    return new Promise((resolve, reject) => {
        // We download via a hidden iframe to get better control over the error cases
        const iframe = document.createElement("iframe");
        iframe.setAttribute("src", url);
        iframe.setAttribute("hidden", "hidden");
        iframe.addEventListener("load", () => {
            const title = iframe.contentDocument.title;
            if (title) {
                reject(title);
            } else {
                resolve();
            }
        });
        document.body.appendChild(iframe);
    });
}

function sosRemove(path) {
    return cockpit.spawn(["bash", "-c", cockpit.format("shopt -s nullglob; rm '$0' '$0'.*", path)],
                         { superuser: true, err: "message" });
}

const SOSDialog = ({ onClose }) => {
    const [label, setLabel] = useState("");
    const [passphrase, setPassphrase] = useState("");
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [obfuscate, setObfuscate] = useState(true);
    const [verbose, setVerbose] = useState(false);
    const [task, setTask] = useState(null);
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [errorDetail, setErrorDetail] = useState(null);

    function run() {
        setError(null);
        setProgress(null);

        const args = [];

        if (label) {
            args.push("--label");
            args.push("cockpit-" + label);
        }

        if (passphrase) {
            args.push("--encrypt-pass");
            args.push(passphrase);
        }

        if (obfuscate) {
            args.push("--clean");
        }

        if (verbose) {
            args.push("-vvv");
        }

        const task = sosCreate(args, setProgress, err => { if (err == "cancelled") onClose(); else setError(err); },
                               setErrorDetail);
        setTask(task);
        task.then(onClose);
        task.finally(() => setTask(null));
    }

    const actions = [];
    actions.push(<Button key="run" isLoading={!!task} isDisabled={!!task} onClick={run}>
        {_("Run report")}
    </Button>);
    if (task)
        actions.push(<Button key="stop" variant="secondary" onClick={() => task.close("cancelled")}>
            {_("Stop report")}
        </Button>);
    else
        actions.push(<Button key="cancel" variant="link" onClick={onClose}>
            {_("Cancel")}
        </Button>);

    return <Modal id="sos-dialog"
                  position="top"
                  variant="medium"
                  isOpen
                  onClose={onClose}
                  footer={
                      <>
                          {actions}
                          {progress ? cockpit.format(_("Progress: $0"), progress.toFixed() + "%") : null}
                      </>
                  }
                  title={ _("Run new report") }>
        { error
            ? <>
                <Alert variant="warning" isInline title={error}>
                    <CodeBlockCode>{errorDetail}</CodeBlockCode>
                </Alert>
                <br />
            </>
            : null }
        <p>{ _("SOS reporting collects system information to help with diagnosing problems.") }</p>
        <p>{ _("This information is stored only on the system.") }</p>
        <br />
        <Form isHorizontal>
            <FormGroup label={_("Report label")}>
                <TextInput value={label} onChange={setLabel} />
            </FormGroup>
            <FormGroup label={_("Encryption passphrase")}
                       helperText="Leave empty to skip encryption">
                <InputGroup>
                    <TextInput type={showPassphrase ? "text" : "password"} value={passphrase} onChange={setPassphrase} />
                    <Button variant="control" onClick={() => setShowPassphrase(!showPassphrase)}>
                        { showPassphrase ? <EyeSlashIcon /> : <EyeIcon /> }
                    </Button>
                </InputGroup>
            </FormGroup>
            <FormGroup label={_("Options")} hasNoPaddingTop>
                <Checkbox label={_("Obfuscate potentially sensitive data")}
                                 isChecked={obfuscate} onChange={setObfuscate} />
                <Checkbox label={_("Use verbose logging")}
                                 isChecked={verbose} onChange={setVerbose} />
            </FormGroup>
        </Form>
    </Modal>;
};

const Menu = ({ items }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Dropdown onSelect={() => setIsOpen(!isOpen)}
                  toggle={<KebabToggle onToggle={setIsOpen} />}
                  isOpen={isOpen}
                  isPlain
                  position="right"
                  dropdownItems={items} />
    );
};

const MenuItem = ({ onClick, onlyNarrow, children }) => (
    <DropdownItem className={onlyNarrow ? "show-only-when-narrow" : null}
                  onKeyPress={onClick}
                  onClick={onClick}>
        {children}
    </DropdownItem>
);

const SOSBody = ({ run_report }) => {
    const mock = useMockData();
    const lister = useObject(sosLister, obj => obj.close, []);
    useEvent(lister, "changed");

    const superuser_proxy = useObject(() => cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Superuser",
                                                                                          "/superuser"),
                                      obj => obj.close(),
                                      []);
    useEvent(superuser_proxy, "changed");

    const raiseError = useErrorHandler();

    console.log("MOCK", mock);

    if (!lister.ready)
        return <EmptyStatePanel loading />;

    if (lister.problem && lister.problem != "access-denied")
        return <EmptyStatePanel title={lister.problem} />;

    function make_report_row(path) {
        const report = lister.reports[path];

        const labels = [];
        if (report.encrypted)
            labels.push(<Label key="enc" color="orange">
                {_("Encrypted")}
            </Label>);
        if (report.obfuscated)
            labels.push(<Label key="obf" color="gray">
                {_("Obfuscated")}
            </Label>);

        const action = (
            <Button variant="secondary" className="show-only-when-wide"
                    onClick={() => sosDownload(path).catch(raiseError)}>
                {_("Download")}
            </Button>);
        const menu = <Menu items={[
            <MenuItem key="download"
                      onlyNarrow
                      onClick={() => sosDownload(path).catch(raiseError)}>
                {_("Download")}
            </MenuItem>,
            <MenuItem key="remove"
                      onClick={() => sosRemove(path).catch(raiseError)}>
                {_("Remove")}
            </MenuItem>
        ]} />;

        return {
            props: { key: path },
            columns: [
                report.label || "-",
                mock.date || report.date,
                { title: <LabelGroup>{labels}</LabelGroup> },
                {
                    title: <>{action}{menu}</>,
                    props: { className: "pf-c-table__action table-row-action" }
                },
            ]
        };
    }

    return (
        <PageSection>
            <div className={lister.problem != "access-denied" ? "hidden" : null}>
                <EmptyStatePanel
                    title={_("Administrative access required")}
                    paragraph={_("Administrative access is required to create and access reports.")}
                    action={
                        <SuperuserDialogs create_trigger={(unlocked, onclick) =>
                            <Button onClick={onclick}>{_("Turn on administrative access")}</Button>}
                                          proxy={superuser_proxy}
                        />}
                />
            </div>
            { !lister.problem &&
            <Card className="ct-card">
                <CardHeader>
                    <CardTitle>
                        <Text component={TextVariants.h2}>{_("Reports")}</Text>
                    </CardTitle>
                    <CardActions>
                        <Button id="create-button" variant="primary" onClick={run_report}>
                            {_("Run report")}
                        </Button>
                    </CardActions>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable variant='compact'
                                    emptyCaption={_("No system reports.")}
                                    columns={ [
                                        { title: _("Report label") },
                                        { title: _("Date") },
                                        { title: _("Attributes") },
                                    ] }
                                    rows={Object.keys(lister.reports).sort().map(make_report_row)}
                    />
                </CardBody>
            </Card>
            }
        </PageSection>);
};

const SOSErrorDialog = ({ error, onClose }) => {
    return <Modal id="sos-error-dialog"
                  position="top"
                  variant="medium"
                  isOpen
                  onClose={onClose}
                  title={ _("Error") }>
        <p>{error}</p>
    </Modal>;
};

const SOSPage = () => {
    const [showDialog, setShowDialog] = useState(false);
    const [error, setError] = useState(null);

    return (
        <Page>
            <WithErrorHandler value={setError}>
                <PageSection variant={PageSectionVariants.light}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <h2 className="pf-u-font-size-3xl">{_("System diagnostics")}</h2>
                    </Flex>
                </PageSection>
                <SOSBody run_report={() => setShowDialog(true)} />
                { showDialog && <SOSDialog onClose={() => setShowDialog(false)} /> }
                { error && <SOSErrorDialog error={error.toString()} onClose={() => setError(null)} /> }
            </WithErrorHandler>
        </Page>);
};

document.addEventListener("DOMContentLoaded", () => {
    cockpit.translate();
    ReactDOM.render(<SOSPage />, document.getElementById('app'));
});
