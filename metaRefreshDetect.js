document.addEventListener("DOMContentLoaded", function(event) {

    // Record the time this fired.
    chrome.runtime.sendMessage({DOMContentLoaded: true});

    var metaRefresh = document.querySelectorAll("meta[http-equiv='refresh']");
    if (metaRefresh.length)
    {
        // Get the last element in case there are more than one. From what I can tell
        // Chrome will only care about the last meta refresh it finds and ignore all
        // previous ones. Other browsers may not work like that, but this is a
        // _Chrome_ extension, isn't it?
        var metaRefreshElement = metaRefresh.item(metaRefresh.length-1);
        var metaRefreshContent = metaRefreshElement.getAttribute('content');

        // spaaaaace
        var metaRefresh = metaRefreshContent.split(/;\s?url\s?=\s?/i);
        var metaRefreshTimer = metaRefresh[0];
        var metaRefreshUrl = (typeof(metaRefresh[1]) != 'undefined') ? metaRefresh[1] : null;

        // We only care if the meta refresh has a URL and it's not the same as the current page.
        if (metaRefreshUrl)
        {
            // Tell the background page that this was a meta refresh
            chrome.runtime.sendMessage({metaRefreshDetails: {'url': qualifyURL(metaRefreshUrl), 'timer': metaRefreshTimer}});
        }

        // Make a relative URL an explicit URL using the magic of DOM
        function qualifyURL(url) {
            var a = document.createElement('a');
            a.href = url;
            return a.href;
        }
    }

    // Collect click events for the page. We're binding to the root
    // and so picking up click events on every element, even page
    // whitespace. This has potential for false positives but javascript
    // links can come from _any_ element, even divs - so we have to
    // live with it.
    document.documentElement.addEventListener('click', function () {
        chrome.runtime.sendMessage({ userClicked: true });
    });
});

