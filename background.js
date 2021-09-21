var RedirectPath = {

    init: function ()
    {
        this.tabs = {};
        var REQUEST_FILTER = {'urls': ['<all_urls>'], 'types': ['main_frame']};
        var EXTRA_INFO = ['responseHeaders'];

        chrome.webRequest.onBeforeRedirect.addListener(this.requestRedirect, REQUEST_FILTER, EXTRA_INFO);
        chrome.webRequest.onCompleted.addListener(this.requestCompleted, REQUEST_FILTER, EXTRA_INFO);
        chrome.webNavigation.onCommitted.addListener(this.navigationCommited);
        chrome.runtime.onMessage.addListener(this.recordClientDetails);

        //chrome.tabs.onUpdated.addListener(this.tabUpdated);
        //chrome.tabs.onCreated.addListener(this.tabUpdate);
        chrome.tabs.onRemoved.addListener(this.tabRemoved);


        this.warningColorMap = {
            error: '#e22b2b',
            warning: '#e58d1c',
            info: '#214a65',
            ok: '#5d945a'
        };

        // Used so our other extension(s) can check if this is installed or not.
        chrome.runtime.onMessageExternal.addListener(function(request, sender, sendResponse) {
            sendResponse({'response': 'whats up'});
        });

        this.versionCheck();
    },
    callback: function() {
        if (chrome.runtime.lastError) {
            console.error("We have an error", chrome.runtime.lastError);
        }
    },
    checkTabIDIsValid: function(tabId, methodName, callbackDone)
    {
        chrome.browserAction[methodName]({tabId: tabId}, function()
        {
            if(callbackDone)
                callbackDone(!chrome.runtime.lastError);
        });
    },
    requestRedirect: function (details)
    {
        RedirectPath.recordPathItem(details.tabId, {
            type: 'server_redirect',
            redirect_type: details.statusCode,
            status_code: details.statusCode,
            url: details.url,
            redirect_url: details.redirectUrl,
            ip: (details.ip) ? details.ip : '(not available)',
            headers: details.responseHeaders,
            status_line: details.statusLine
        });
    },
    requestCompleted: function (details)
    {
        RedirectPath.setServerRequestByUrl(details.tabId, details);

        RedirectPath.onServerClientPathSync(details.tabId, details.url)
    },
    navigationCommited: function (details)
    {
        if (details.transitionType != 'auto_subframe')
        {
            RedirectPath.setClientRequestByUrl(details.tabId, details);

            RedirectPath.onServerClientPathSync(details.tabId, details.url);
        }
    },
    recordClientDetails: function (request, sender)
    {

        var tabId = sender.tab.id;
        var tab = RedirectPath.getTab(tabId);

        if (request.userClicked)
        {
            console.log('USER CLICKED A THING');
            tab.userClicked = true;
        }
        else if (request.metaRefreshDetails)
        {
            tab.meta[sender.tab.url] = request.metaRefreshDetails;
        }

        RedirectPath.setTab(tabId, tab);
    },
    getStatusObject : function(pathItem)
    {
        var statusCode = pathItem.status_code;
        var redirectType = pathItem.type;

        var statusMap = {
            '400_javascript':   { classes: ['statusError', 'iconRedirect', 'clientRedirect'],   level: 'error',     priority: 13 },
            '400_meta':         { classes: ['statusError', 'iconRedirect', 'clientRedirect'],   level: 'error',     priority: 12 },
            '400':              { classes: ['statusError', 'iconWarning'],                      level: 'error',     priority: 11 },
            '500':              { classes: ['statusError', 'iconWarning'],                      level: 'error',     priority: 10 },
            '500_javascript':   { classes: ['statusWarning', 'iconRedirect', 'clientRedirect'], level: 'warning',   priority: 9 },
            '500_meta':         { classes: ['statusWarning', 'iconRedirect', 'clientRedirect'], level: 'warning',   priority: 8 },
            '503':              { classes: ['statusWarning', 'iconWarning'],                    level: 'warning',   priority: 7 },
            '302':              { classes: ['statusWarning', 'iconRedirect'],                   level: 'warning',   priority: 6 },
            '300':              { classes: ['statusWarning', 'iconRedirect'],                   level: 'warning',   priority: 5 },
            '200_javascript':   { classes: ['statusInfo', 'iconRedirect', 'clientRedirect'],    level: 'info',      priority: 4 },
            '200_meta':         { classes: ['statusInfo', 'iconRedirect', 'clientRedirect'],    level: 'info',      priority: 3 },
            '301':              { classes: ['statusInfo', 'iconRedirect'],                      level: 'info',      priority: 2 },
            '200':              { classes: ['statusOk', 'iconOk'],                              level: 'ok',        priority: 1 }
        }

        var statusCodeLookup = statusCode.toString();

        if (redirectType == 'client_redirect')
        {
            statusCodeLookup = statusCodeLookup + '_' + pathItem.redirect_type;
        }

        if (!statusMap[statusCodeLookup])
        {
            // We didn't get a specific status code match, round down to the nearest 100
            // and try again.
            statusCodeLookup = (Math.floor(statusCode / 100) * 100).toString();

            if (redirectType == 'client_redirect')
            {
                statusCodeLookup = statusCodeLookup + '_' + pathItem.redirect_type;
            }
        }

        if (!statusMap[statusCodeLookup] && redirectType == 'client_redirect')
        {
            // Do it again with out any client redirect appended.
            statusCodeLookup = (Math.floor(statusCode / 100) * 100).toString();
        }

        return statusMap[statusCodeLookup] || null;
    },
    onServerClientPathSync: function (tabId, url)
    {
        // This "event" will execute when both final client (webNavigation) and server (webRequest) events have been received.
        // We need data from both of the callbacks to determine what type of redirect this was, and if we need to reset the path etc.

        var currentClientRequestDetails = this.getClientRequestByUrl(tabId, url);
        var currentServerRequestDetails = this.getServerRequestByUrl(tabId, url);

        // Both populated, we're clear to proceed.
        if (currentClientRequestDetails && currentServerRequestDetails)
        {
            // Build the pathItem object with what we know so far
            var pathItem = {
                type: 'normal',
                redirect_type: 'none',
                status_code: currentServerRequestDetails.statusCode,
                url: currentServerRequestDetails.url,
                ip: (currentServerRequestDetails.ip) ? currentServerRequestDetails.ip : '(not available)',
                headers: currentServerRequestDetails.responseHeaders,
                status_line: currentServerRequestDetails.statusLine
            };

            var tab = this.getTab(tabId);

            // Forward/back can get trapped by JS (pushState) so if we pick up that
            // qualifier mark it as user generated (which it is)
            if (currentClientRequestDetails.transitionQualifiers.indexOf('forward_back') !== -1)
            {
                tab.userClicked = true;
            }

            // We got here from a client redirect, so the path hasn't ended yet. Also the user hasn't fired any click events
            // on this page.
            if (currentClientRequestDetails.transitionQualifiers.indexOf('client_redirect') !== -1 && tab.userClicked !== true)
            {
                tab = this.setClientRedirectData(tab, currentClientRequestDetails);
            }
            else if (tab.previousClientRequest !== null)
            {
                // We didn't get to the current page via a client redirect, or if we did it was a user initiated client redirect (tab.userClicked)
                // To reset the path we'll remove everything from the path from before (and including) the previous client request/page. If
                // there was no previous client request we'll never get here and the path will be fresh anyway.

                var indexToRemove = tab.path.map(function (el)
                {
                    return el.url;
                }).indexOf(tab.previousClientRequest.url);

                console.log('Removing up to and including previous client request.', tab.previousClientRequest);

                tab.path.splice(0, (indexToRemove + 1));
            }

            tab.userClicked = false;

            // Every time the path "syncs" like this, we can discard any of the meta data about
            // the previous URLs in the path, we will "render" it down in to the path anyway.
            tab.serverClientSyncPath = {
                client: {},
                server: {}
            };

            this.recordPathItem(tabId, pathItem);

            //this.outputDebugPath(tabId);

            tab.previousClientRequest = currentClientRequestDetails;

            this.setTab(tabId, tab);
        }
    },
    setClientRedirectData: function (tab, currentClientRequestDetails)
    {
        // Btw, we're editing the pathItem for the PREVIOUS client request to set the details of the
        // client request it initiated. Get the path, as well as the previous client
        // request to match urls and what not.
        if (tab.previousClientRequest)
        {
            var indexToModify = tab.path.map(function (el, idx)
            {

                return el.url;
            }).lastIndexOf(tab.previousClientRequest.url);

            // lastIndexOf above so we get the most recent client url. This only matters
            // in a refresh scenario where using indexOf doesn't work.

            var pathItemToModify = tab.path[indexToModify];

            pathItemToModify.type = 'client_redirect';
            pathItemToModify.redirect_type = 'javascript';

            // Default, set the redirect url to the current client URL, but this
            // won't be correct if we got here via a server redirect. The next
            // if takes care of that
            pathItemToModify.redirect_url = currentClientRequestDetails.url;

            // Set the redirect URL to the URL that came right after the last
            // client request in the path if there is such a thing. Picks up
            // client > server redirects.
            if (tab.path[(indexToModify + 1)])
            {
                pathItemToModify.redirect_url = tab.path[(indexToModify + 1)].url;
            }

            if (typeof(tab.meta[tab.previousClientRequest.url]) !== 'undefined')
            {
                var metaInformation = tab.meta[tab.previousClientRequest.url];

                pathItemToModify.redirect_type = 'meta'
                pathItemToModify.redirect_url = metaInformation.url;
                pathItemToModify.meta_timer = metaInformation.timer;
            }

            tab.path[indexToModify] = pathItemToModify;
        }

        return tab;
    },
    getClientRequestByUrl: function (tabId, url)
    {
        var tab = this.getTab(tabId);

        return tab.serverClientSyncPath.client[url] || null;
    },
    getServerRequestByUrl: function (tabId, url)
    {
        var tab = this.getTab(tabId);

        return tab.serverClientSyncPath.server[url] || null;
    },
    setClientRequestByUrl: function (tabId, request)
    {
        var tab = this.getTab(tabId);

        tab.serverClientSyncPath.client[request.url] = request;

        this.setTab(tabId, tab);
    },
    setServerRequestByUrl: function (tabId, request)
    {
        var tab = this.getTab(tabId);

        tab.serverClientSyncPath.server[request.url] = request;

        this.setTab(tabId, tab);
    },
    recordPathItem: function (tabId, pathItem)
    {
        /*
         pathItem = {
         tabId: 0,
         type: 'normal', 'server_redirect', 'client_redirect'
         redirect_type: 3XX, javascript, meta, none
         url:
         ip: if (!details.ip) details.ip = '(not available)';
         headers: []
         status_line: HTTP/1.1 302 Found
         status_code: HTTP/1.1 302 Found
         }
         */

        if (tabId > 0)
        {
            var tab = this.getTab(tabId);

            tab.lastactive = new Date().getTime();

            // Fill in optional stuff
            pathItem.redirect_url = pathItem.redirect_url || null;
            pathItem.meta_timer = pathItem.meta_timer || null;

            tab.path.push(pathItem);

            // Limit the path to 20 steps.
            if (tab.path.length > 20)
            {
                var step = tab.path.shift();

                console.log(tabId, 'Path was too long - removed the first step on the path', step);
            }

            var highestPriorityPathItem = {};
            var highestPriorityStatus = 0;

            var self = this;
            tab.path.forEach(function (pathItem, index)
            {
                // First actually set the status object. We're doing this here
                // and re-setting previously set status objects because the status
                // could have changed after the path item was originally recorded
                // i.e. a 200 can become a 200_meta after a redirect fires.

                pathItem.statusObject = self.getStatusObject(pathItem);
                tab.path[index] = pathItem;

                if (pathItem.statusObject.priority > highestPriorityStatus)
                {
                    highestPriorityStatus = pathItem.statusObject.priority;
                    highestPriorityPathItem = pathItem;
                }
            });

            this.setBadge(tabId, highestPriorityPathItem, tab.path.length);
            this.setTab(tabId, tab);

            // Perform GC 30 out of every 100 requests.
            if (this.rand(1, 100) <= 30)
            {
                console.log('RANDOM GC STARTED');
                this.garbageCollect();
            }

            return;
        }
    },
    setBadge : function(tabId, pathItem, pathItemCount)
    {
        chrome.browserAction.setIcon({path: "assets/images/rpath19.png", tabId: tabId}, this.callback);

        if (parseInt(pathItem.status_code) >= 300 || pathItem.type == 'client_redirect')
        {
            var badgeText = pathItem.status_code.toString();

            // Set variable as issue with directly calling the level index
            // in setBadgeBackgroundColor
            var badgeColour = this.warningColorMap[pathItem.statusObject.level];

            if (pathItem.type == 'client_redirect')
            {
                badgeText = (pathItem.redirect_type == 'javascript') ? 'JS' : 'Meta';
            }

            // We have more than 1 redirect, we append a '+' to badgeText
            // more than 2 pathItem objects - we have more 2 redirect

            // NOTE: This is commented out because in the most recent versions of Chrome they introduced
            // the "material" theme. This has made the default font size for the badge text very slightly bigger
            // in comparison to the space it was in, meaning "301+" now displays as "30..". Until we can find a
            // better UX method to fix this, don't add the +.

            // if (pathItemCount > 2) {
            //     badgeText = badgeText + "+";
            // }

            // Check we have a tab with badge text
            // If no - we handle the error
            this.checkTabIDIsValid(tabId, 'getBadgeText', function(res){
                if (res) {
                    chrome.browserAction.setBadgeText({text: badgeText, tabId: tabId});
                }
            });

            // Check we have a tab with badge background color
            // If no - we handle the error
            this.checkTabIDIsValid(tabId, 'getBadgeBackgroundColor', function(res){
                if (res) {
                    chrome.browserAction.setBadgeBackgroundColor({color: badgeColour, tabId: tabId});
                }
            });
        }
    },
    tabRemoved: function (tabId, removeInfo)
    {
        console.log('Tab ' + tabId + ' is being removed');

        if (typeof(RedirectPath.tabs[tabId]) != 'undefined')
        {
            console.log('We had data for ' + tabId + ', freeing now', RedirectPath.tabs);

            delete RedirectPath.tabs[tabId];
        }
        else
        {
            console.log('We had no data for tab ' + tabId, RedirectPath.tabs);
        }

        RedirectPath.garbageCollect();
    },
    // Look at all active tabs and remove data we have for any
    // tabs that aren't visible & more than 30 seconds old.
    garbageCollect: function ()
    {
        chrome.windows.getAll({populate: true}, function (windows)
        {
            var visibleTabs = [];

            for (var i = 0; i < windows.length; i++)
            {
                var windowscan = windows[i];

                for (var ii = 0; ii < windowscan.tabs.length; ii++)
                {
                    var tab = windowscan.tabs[ii];
                    visibleTabs.push(tab.id.toString());
                }
            }

            var stamp = new Date().getTime();

            for (var tabId in this.tabs)
            {
                var age = (stamp - this.tabs[tabId].lastactive);

                if (visibleTabs.indexOf(tabId) == -1 && age > 30000) // 30 seconds
                {
                    delete this.tabs[tabId];

                    console.log('GC: tab ' + tabId + ' wasnt visible and is stale, so was freed', this.tabs);
                }

            }
        });
    },
    getTab: function (tabId)
    {
        if (typeof(this.tabs[tabId]) != 'undefined')
        {
            return this.tabs[tabId];
        }

        // Not seen this tab, init it.
        return {
            path: [],
            meta: {},
            serverClientSyncPath: {
                client: {},
                server: {}
            },
            previousClientRequest: null
        };
    },
    setTab: function (tabId, tab)
    {
        this.tabs[tabId] = tab;
    },
    rand: function (min, max)
    {
        return Math.random() * (max - min) + min;
    },
    onInstall: function ()
    {
        //console.log("Extension Installed");
    },
    onUpdate: function ()
    {
        //console.log("Extension Updated");
    },
    getVersion: function ()
    {
        return chrome.runtime.getManifest().version;
    },
    versionCheck: function ()
    {
        var currVersion = this.getVersion();
        var prevVersion = localStorage['version'];

        if (currVersion != prevVersion)
        {
            // Check if we just installed this extension.
            if (typeof prevVersion == 'undefined')
            {
                this.onInstall();
            }
            else
            {
                this.onUpdate();
            }

            localStorage['version'] = currVersion;
        }

        console.log('Current version is: ' + localStorage['version']);
    },
    outputDebugPath: function (tabId)
    {
        var path = this.getTab(tabId).path;
        var debugPath = [];

        path.forEach(function (pathItem)
        {
            debugPath.push({
                url: pathItem.url,
                status: pathItem.status_line,
                redirect_type: pathItem.redirect_type,
                redirect_url: pathItem.redirect_url,
                meta_timer: pathItem.meta_timer
            });
        });

        console.table(debugPath);
    }
};

RedirectPath.init();
