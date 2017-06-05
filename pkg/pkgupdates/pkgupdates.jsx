var $ = require('jquery');
var cockpit = require('cockpit');
var React = require('react');
var moment = require('moment');
var Tooltip = require('cockpit-components-tooltip.jsx').Tooltip;

const _ = cockpit.gettext;

// 'available' heading is built dynamically
const STATE_HEADINGS = {
    'loading': _('Loading available updates, please wait...'),
    'uptodate': _('No updates available, system is up to date'),
    'applying': _('Applying updates'),
    'updateError': _('Applying updates failed'),
    'loadError': _('Loading available updates failed'),
}

// see https://github.com/hughsie/PackageKit/blob/master/lib/packagekit-glib2/pk-enum.h
const PK_EXIT_ENUM_SUCCESS = 1;
const PK_EXIT_ENUM_FAILED = 2;
const PK_ROLE_ENUM_REFRESH_CACHE = 13;
const PK_INFO_ENUM_SECURITY = 8;
const PK_STATUS_ENUM_UPDATE = 10;

const PK_STATUS_STRINGS = {
    9: _('Downloading'),
    10: _('Updating'),
    11: _('Cleaning up'),
    14: _('Verifying'),
}

var dbus_pk = cockpit.dbus('org.freedesktop.PackageKit', {superuser: 'try'});

function pkTransaction() {
    var dfd = cockpit.defer();

    dbus_pk.call('/org/freedesktop/PackageKit', 'org.freedesktop.PackageKit', 'CreateTransaction', [], {timeout: 5000})
        .done(result => {
            var transProxy = dbus_pk.proxy('org.freedesktop.PackageKit.Transaction', result[0]);
            transProxy.wait(() => {dfd.resolve(transProxy)});
        })
        .fail(ex => {dfd.reject(ex)});

    return dfd.promise();
}

// parse CVEs from an arbitrary text (changelog) and return URL array
function parseCVEs(text) {
    if (!text)
        return [];

    var cves = text.match(/CVE-\d{4}-\d+/g);
    if (!cves)
        return [];
    return cves.map(n => 'https://cve.mitre.org/cgi-bin/cvename.cgi?name=' + n);
}

function deduplicate(list) {
    var d = { };
    list.forEach(i => {if (i) d[i] = true});
    var result = Object.keys(d);
    result.sort();
    return result;
}

function commaJoin(list) {
    return list.reduce((prev, cur) => [prev, ', ', cur])
}

function HeaderBar(props) {
    var num_updates = Object.keys(props.updates).length;
    var num_security = 0;
    var state;
    if (props.state == 'available') {
        state = cockpit.ngettext('$0 update', '$0 updates', num_updates);
        for (var u in props.updates)
            if (props.updates[u].security)
                ++num_security;
        if (num_security > 0)
            state += cockpit.ngettext(', including $1 security fix', ', including $1 security fixes',  num_security);
        state = cockpit.format(state, num_updates, num_security);
    } else
        state = STATE_HEADINGS[props.state];

    return (
        <div className='content-header-extra'>
            <table width='100%'>
                <tr>
                    <td id='state'>{state}</td>
                    {props.state == 'uptodate' || props.state == 'available' ?
                        <td className='text-right'>{props.timeSinceRefresh ?
                            <span style={{paddingRight: '3ex'}}>
                                {cockpit.format(_('Last checked: $0 ago'), moment.duration(props.timeSinceRefresh * 1000).humanize())}
                            </span>
                            : null}
                            <button className='btn btn-default' onClick={() => props.onRefresh()} >Check for updates</button>
                        </td>
                        : null}
                </tr>
            </table>
        </div>
    );
}

function UpdateItem(props) {
    const info = props.info;
    const id_fields = props.id.split(';');
    var bugs = null;
    var security_info = null;

    if (info.bug_urls && info.bug_urls.length)
        // we assume a bug URL ends with a number; if not, show the complete URL
        bugs = commaJoin(info.bug_urls.map(u => <a rel='noopener' referrerpolicy='no-referrer' target='_blank' href={u}>{u.match(/[0-9]+$/) || u}</a>));

    if (info.security) {
        security_info = (
            <p>
                <span className='fa fa-bug security-label'> </span>
                <span className='security-label-text'>{_('Security Update') + (info.cve_urls.length ? ': ' : '')}</span>
                {commaJoin(info.cve_urls.map(u => <a href={u} rel='noopener' referrerpolicy='no-referrer' target='_blank'>{u.match(/[^/=]+$/)}</a>))}
            </p>
        );
    }

    return (
        <tbody>
            <tr className={'listing-ct-item' + (info.security ? ' security' : '')}>
                <th>
                  <Tooltip tip={info.summary}>
                    <span>{info.packageNames ? commaJoin(info.packageNames.sort()) : id_fields[0]}</span>
                  </Tooltip>
                </th>
                <td className='narrow'>{id_fields[1]}</td>
                <td className='narrow'>{bugs}</td>
                <td className='changelog'>{security_info}{info.description}</td>
            </tr>
        </tbody>
    );
}

function UpdatesList(props) {
    // sort security first
    var updates = Object.keys(props.updates);
    updates.sort((a, b) => {
        if (props.updates[a].security && !props.updates[b].security)
            return -1;
        if (!props.updates[a].security && props.updates[b].security)
            return 1;
        return a.localeCompare(b);
    });

    return (
        <table className='listing-ct'>
            <thead>
                <tr>
                    <th>{_('Name')}</th>
                    <th>{_('Version')}</th>
                    <th>{_('Bugs')}</th>
                    <th>{_('Details')}</th>
                </tr>
            </thead>
            {updates.map(id => <UpdateItem id={id} info={props.updates[id]} />)}
        </table>
    );
}

class ApplyUpdates extends React.Component {
    constructor() {
        super();
        this.state = {percentage: null, timeRemaining: null, curStatus: null, curPackage: null};
    }

    componentDidMount() {
        var transProxy = this.props.transaction;

        $(transProxy).on('Package', (event, info, packageId) => {
            var pfields = packageId.split(';');
            // info: see PK_STATUS_* at https://github.com/hughsie/PackageKit/blob/master/lib/packagekit-glib2/pk-enum.h
            this.setState({curPackage: pfields[0] + ' ' + pfields[1],
                           curStatus: info,
                           percentage: transProxy.Percentage <= 100 ? transProxy.Percentage : null,
                           timeRemaining: transProxy.RemainingTime > 0 ? transProxy.RemainingTime : null});
        });
    }

    render() {
        var action;

        if (this.state.curPackage)
            action = (
                <span>
                    <strong>{PK_STATUS_STRINGS[this.state.curStatus || PK_STATUS_ENUM_UPDATE] || PK_STATUS_STRINGS[PK_STATUS_ENUM_UPDATE]}</strong>
                    &nbsp;{this.state.curPackage}
                </span>
            );
        else
            action = _('Initializing...');

        return (
            <div>
                <div className='progress-description'>
                    <div className='spinner spinner-xs spinner-inline'></div>
                    {action}
                </div>

                {this.state.percentage !== null
                    ? (<div className='progress progress-label-top-right'>
                          <div className='progress-bar' role='progressbar'
                               ariaValuenow={this.state.percentage} ariaValuemin='0' ariaValuemax='100'
                               style={{width: this.state.percentage + '%'}}>
                               {this.state.timeRemaining !== null ? <span>{moment.duration(this.state.timeRemaining * 1000).humanize()}</span> : null}
                          </div>
                      </div>)
                    : null}
            </div>
        );
    }
}

class OsUpdates extends React.Component {
    constructor() {
        super();
        this.state = {state: 'loading', errorMessages: [], updates: {}, haveSecurity: false, timeSinceRefresh: null};
        this.handleError = this.handleError.bind(this);
        this.handleRefresh = this.handleRefresh.bind(this);
    }

    handleError(ex) {
        this.state.errorMessages.push(ex.message || ex);
        this.setState({state: 'loadError'});
    }

    formatDescription(text) {
        // on Debian they start with "== version ==" which is redundant; we
        // don't want Markdown headings in the table
        return text.trim().replace(/^== .* ==\n/, '').trim();
    }

    loadUpdateDetails(pkg_ids) {
        // PackageKit doesn't expose source package names, so group packages with the same version and changelog
        // create a reverse version+changes → id map on iteration
        var sameUpdate = {};

        pkTransaction()
            .done(transProxy => {
                $(transProxy).on('UpdateDetail', (event, packageId, updates, obsoletes, vendor_urls,
                                                  bug_urls, cve_urls, restart, update_text, changelog
                                                  /* state, issued, updated */) => {
                    let u = this.state.updates[packageId];
                    u.vendor_urls = vendor_urls;
                    u.bug_urls = deduplicate(bug_urls);
                    u.description = this.formatDescription(update_text || changelog);

                    // did we already see the same version and description? then merge
                    let id_fields = packageId.split(';');
                    let hash = id_fields[1] + u.description;
                    let seenId = sameUpdate[hash];
                    if (seenId) {
                        this.state.updates[seenId].packageNames.push(id_fields[0]);
                        delete this.state.updates[packageId];
                    } else {
                        // this is a new update
                        sameUpdate[hash] = packageId;
                        u.packageNames = [id_fields[0]];

                        // many backends don't support this; parse CVEs from description as a fallback
                        u.cve_urls = deduplicate(cve_urls && cve_urls.length > 0 ? cve_urls : parseCVEs(u.description));
                        if (u.cve_urls && u.cve_urls.length > 0)
                            u.security = true;
                        // u.restart = restart; // broken (always '1') at least in Fedora
                    }

                    this.setState({updates: this.state.updates, haveSecurity: this.state.haveSecurity || u.security});
                });

                $(transProxy).on('Finished', () => {
                    this.setState({state: 'available'});
                });

                $(transProxy).on('ErrorCode', (event, code, details) => {
                    console.warn('UpdateDetail error:', code, details);
                    // still show available updates, with reduced detail
                    this.setState({state: 'available'});
                });

                transProxy.GetUpdateDetail(pkg_ids)
                    .fail(ex => {
                        console.warn('GetUpdateDetail failed:', ex);
                        // still show available updates, with reduced detail
                        this.setState({state: 'available'});
                    });
            });
    }

    componentDidMount() {
        var updates = {};

        pkTransaction()
            .done(transProxy => {
                $(transProxy).on('Package', (event, info, packageId, _summary) => {
                    updates[packageId] = {summary: _summary, security: info == PK_INFO_ENUM_SECURITY};
                });

                $(transProxy).on('ErrorCode', (event, code, details) => {
                    this.state.errorMessages.push(details);
                    this.setState({state: 'loadError'});
                });

                // when GetUpdates() finished, get the details for all packages
                $(transProxy).on('Finished', () => {
                    var pkg_ids = Object.keys(updates);
                    if (pkg_ids.length) {
                        this.setState({updates: updates});
                        this.loadUpdateDetails(pkg_ids);
                    } else {
                        this.setState({state: 'uptodate'});
                    }
                });

                // read available updates; causes emission of Package and Error, doesn't return anything by itself
                transProxy.GetUpdates(0)
                    .fail(this.handleError);
            })
            .fail(ex => this.handleError((ex.problem == 'not-found') ? _('PackageKit is not installed') : ex));

        // return type is 'u', but returns -1 if not supported; so ignore implausibly high values (> 10 years)
        dbus_pk.call('/org/freedesktop/PackageKit', 'org.freedesktop.PackageKit', 'GetTimeSinceAction',
                     [PK_ROLE_ENUM_REFRESH_CACHE], {timeout: 5000})
            .done(seconds => (seconds > 315360000 || this.setState({timeSinceRefresh: seconds})))
            .fail(ex => {console.warn('failed to get time of last refresh: ' + ex.message)});
    }

    apply_updates(securityOnly) {
        pkTransaction()
            .done(transProxy =>  {
                this.setState({state: 'applying', apply_transaction: transProxy});

                $(transProxy).on('ErrorCode', (event, code, details) => { this.handleError(details) });
                $(transProxy).on('Finished', (event, exit) => {
                    if (exit == PK_EXIT_ENUM_SUCCESS) {
                        this.setState({state: 'loading', haveSecurity: false});
                        this.componentDidMount();
                    } else {
                        this.handleError(exit != PK_EXIT_ENUM_FAILED ? ('Error code ' +  exit) : '');
                    }
                });

                // not working/being used in at least Fedora
                $(transProxy).on('RequireRestart', (event, type, packageId) => {
                    console.log('update RequireRestart', type, packageId);
                });

                var ids = Object.keys(this.state.updates);
                if (securityOnly)
                    ids = ids.filter(id => this.state.updates[id].security);

                // returns immediately without value
                transProxy.UpdatePackages(0, ids)
                          .fail(this.handleError);
            })
            .fail(this.handleError);
    }

    renderContent() {
        switch (this.state.state) {
            case 'loading':
                return <div className='spinner spinner-lg' />;

            case 'available':
                return (
                    <div>
                        <table width='100%'>
                            <tr>
                                <td><h2>{_('Available Packages')}</h2></td>
                                <td className='text-right'>
                                    { this.state.haveSecurity
                                      ? <button className='btn btn-default'
                                                 onClick={() => { this.apply_updates(true); }}>
                                            {_('Install security updates')}
                                         </button>
                                      : null
                                    }
                                    &nbsp; &nbsp;
                                    <button className='btn btn-primary'
                                            onClick={() => { this.apply_updates(false); }}>
                                        {_('Install all updates')}
                                    </button>
                                </td>
                            </tr>
                        </table>
                        <UpdatesList updates={this.state.updates} />
                    </div>
                );

            case 'loadError':
            case 'updateError':
                return this.state.errorMessages.map(m => <pre>{m}</pre>);

            case 'applying':
                return <ApplyUpdates transaction={this.state.apply_transaction}/>

            default:
                return null;
        }
    }

    handleRefresh() {
        this.setState({state: 'loading'});
        pkTransaction()
            .done(transProxy =>  {
                $(transProxy).on('ErrorCode', (event, code, details) => this.handleError(details));
                $(transProxy).on('Finished', (event, exit) => {
                    if (exit == PK_EXIT_ENUM_SUCCESS)
                        this.componentDidMount();
                    else
                        this.setState({state: 'loadError'});
                });

                transProxy.RefreshCache(true)
                    .fail(this.handleError);
            })
            .fail(this.handleError);
    }

    render() {
        return (
            <div>
                <HeaderBar state={this.state.state} updates={this.state.updates} timeSinceRefresh={this.state.timeSinceRefresh} onRefresh={this.handleRefresh}/>
                <div className='container-fluid'>
                    {this.renderContent()}
                </div>
            </div>
        );
    }
}

document.addEventListener('DOMContentLoaded', () => {
    React.render(<OsUpdates />, document.getElementById('app'));
});
