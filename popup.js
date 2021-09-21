var RedirectPathPopup = {

    RedirectPath: chrome.extension.getBackgroundPage().RedirectPath,
    clipboardPath: {csv: $('<textarea />'), text: $('<textarea />')},

    alertSuiteId: 'nbjdmeadccgbgmjhbahkgadffhpejgbd',
    alertSuiteBanner: {url: 'http://ayi.ma/pageinsights', banner: '../assets/images/page-insights-ad.mp4'},

    init: function () {
        var self = this;

        $('.pathContainer').on("click", ".pathItem:not(.noHeaders)", this.bindContainerClicks);

        $('.copy button').on('click', function (e) {
            e.preventDefault();

            var btn = $(this);
            var clipboardContainer = self.clipboardPath[btn.data('copy')];

            var input = document.createElement('textarea');
            document.body.appendChild(input);

            input.value = clipboardContainer.val();

            input.focus();
            input.select();

            document.execCommand('Copy');

            input.remove();
        });

        $('a').click(function (e) {
            chrome.tabs.create({'url': $(this).attr('href')});
        });

        this.getTabAndRender();
    },
    getTabAndRender: function () {
        var self = this;
        chrome.tabs.query({active: true, windowId: chrome.windows.WINDOW_ID_CURRENT}, function (tab) {
            var currentTab = tab[0];

            var tabInformation = self.RedirectPath.getTab(currentTab.id);

            var redirectPath = null;
            if (tabInformation) {
                redirectPath = tabInformation.path;
            }

            self.renderPathPopup(redirectPath);

            // Fix height after rendering - this removes a strange "resize" artifact
            // and hopefully fixes the extension sometimes failing to size it's self
            // correctly - https://code.google.com/p/chromium/issues/detail?id=428044
            $('html,body').css({height: $('html').height()});
        });
    },

    renderBanner: function (banner) {
        // This 1ms delay is thanks to Windows. There's an odd bug
        // that causes the popup display to take 4-5 seconds when the popup
        // has a video in it. Even if we add the video at domready the
        // delay still happens - waiting even 1ms is enough to apprently
        // bypass what ever is causing this. Go figure.

        // Jan 2017: This problem has gotten worse, and the 1ms delay now
        // needs to be a 1000 ms delay. Neat.

        var self = this;
        setTimeout(function () {
            var bannerElement = $(".bannerContainer .banner");

            bannerElement.find('a').attr('href', banner.url);
            bannerElement.find('source[type="video/mp4"]').attr('src', banner.banner);
            bannerElement.find('source[type="video/webm"]').attr('src', banner.webm);
            bannerElement.find('video').get(0).load();
            bannerElement.removeClass('hide');
        }, 1000);
    },

    bindContainerClicks: function (e) {
        if ($(e.target).is('a.close')) {
            e.preventDefault();
            $('.pathItem').removeClass('expanded');
            $('.pathResponseHeaders').slideUp('fast');
        }
        else if ($('.pathResponseHeaders', this).not(':visible').length > 0) {
            $('.pathItem').removeClass('expanded');
            $(this).addClass('expanded');
            $('.pathResponseHeaders').slideUp('fast');
            $('.pathResponseHeaders', this).slideDown('fast');
        }
    },
    renderPathPopup: function (redirectPath) {
        console.log('PATH FOR CURRENT TAB', redirectPath);

        var self = this;

        if (redirectPath.length) {
            $('.copy button').prop('disabled', false);
            self.clipboardPath.csv.append("Status Code\tURL\tIP\tPage Type\tRedirect Type\tRedirect URL\t");

            $(redirectPath).each(function (idx, pathItem) {

                var template = $('.template').clone();

                template.find('h2').html(pathItem.url);

                var headerString = self.getHeaderString(pathItem);
                template.find('h3').html(headerString);

                self.clipboardPath.text.append((idx + 1) + '. ' + pathItem.url + ' - ' + headerString + "\r");

                self.setNote(pathItem, template);

                template.addClass(pathItem.statusObject.classes.join(' '));

                self.renderPathIcon(pathItem, template);

                self.renderHeaders(pathItem, template)

                template.removeClass('template').appendTo('.pathContainer');


                self.clipboardPath.csv.append("\r" + pathItem.status_code);
                self.clipboardPath.csv.append("\t" + pathItem.url);
                self.clipboardPath.csv.append("\t" + pathItem.ip);
                self.clipboardPath.csv.append("\t" + pathItem.type);

                var redirectType = pathItem.redirect_type;
                if (pathItem.status_code === 301 || pathItem.status_code === 308) {
                    redirectType = 'permanent';
                }
                else if (pathItem.status_code > 301) {
                    redirectType = 'temporary';
                }

                self.clipboardPath.csv.append("\t" + redirectType);

                var redirectUrlString = (pathItem.redirect_url) ? pathItem.redirect_url : 'none';
                self.clipboardPath.csv.append("\t" + redirectUrlString);


            });
        }
        else {
            var template = $('.template').clone();

            template.find('h2').html('Sorry, there is currently no information available for this tab.');
            template.find('h3').html('Please load a URL to gather information on your path.');

            template.addClass('statusWarning iconWarning noHeaders');

            template.removeClass('template').appendTo('.pathContainer');
        }
    },
    setNote: function (pathItem, template) {
        if (pathItem.status_code == 307) {
            $(pathItem.headers).each(function (idx, header) {
                // 307 is a temp redirect, unless it's not.
                if (header.name == 'Non-Authoritative-Reason' && header.value == 'HSTS') {
                    redirectType = 'Internal (browser cached)';

                    // This is an internal Chrome "HSTS" Redirect. Chrome maintains a cached
                    // list of domains that should always redirect to HTTPS if the request comes in via
                    // HTTP, if there is a cache hit Chrome will NOT visit the server via HTTP and instead
                    // will inject its own "307" redirect. Long story short, there is no way to know what
                    // the original redirect code on the server side was, so we need to leave it as 307 with
                    // an explanation:
                    template.find('p#note').removeClass('hide');
                    template.find('p#note strong').html('The server has previously indicated this domain ' +
                        'should always be accessed via HTTPS (HSTS Protocol). Chrome has cached this internally, ' +
                        'and did not connect to any server for this redirect. Chrome reports this redirect as a ' +
                        '"307 Internal Redirect" however this probably would have been a ' +
                        '"301 Permanent redirect" originally. You can verify this by clearing your browser cache and ' +
                        'visiting the original URL again. ');
                }
            });
        }
    },
    getHeaderString: function (pathItem) {
        var statusString = pathItem.status_code + ': ' + pathItem.status_line;

        if (pathItem.type == 'server_redirect') {
            var redirectType = 'Temporary';

            if (pathItem.status_code == 301 || pathItem.status_code == 308) {
                redirectType = 'Permanent';
            }

            if (pathItem.status_code == 307) {
                $(pathItem.headers).each(function (idx, header) {
                    // 307 is a temp redirect, unless it's not.
                    if (header.name == 'Non-Authoritative-Reason' && header.value == 'HSTS') {
                        redirectType = 'Internal (browser cached)';
                    }
                });
            }

            statusString = pathItem.status_code + ': ' + redirectType + ' redirect to ' + pathItem.redirect_url;
        }
        else if (pathItem.status_code == 404) {
            statusString = pathItem.status_code + ': This page is NOT FOUND';
        }
        else if (pathItem.status_code == 503) {
            // Search the headers for a retry-after.
            var retryAfter = '';
            if (typeof(pathItem.headers) != 'undefined') {
                $(pathItem.headers).each(function (idx, val) {
                    if (pathItem.name == 'Retry-After') {
                        retryAfter = ' Retry after ' + pathItem.value + ' seconds.';
                    }
                });
            }

            statusString = pathItem.status_code + ': Page temporarily unavailable.' + retryAfter;
        }

        if (pathItem.type == 'client_redirect') {
            statusString = pathItem.status_code + ' then ' + pathItem.redirect_type.toUpperCase() + ' redirect to ' + pathItem.redirect_url;
        }

        return statusString;

    },
    renderHeaders: function (pathItem, template) {
        var responseTemplate = template.find('.pathResponseHeaders li').clone();
        template.find('.pathResponseHeaders li').remove();

        // Add the IP first.
        var ipResponseTemplate = responseTemplate.clone();

        ipResponseTemplate.find('.responseKey').html('Server IP Address');
        ipResponseTemplate.find('.responseValue').html(pathItem.ip);
        ipResponseTemplate.appendTo(template.find('.pathResponseHeaders'));

        if (typeof(pathItem.headers) != 'undefined') {
            $(pathItem.headers).each(function (idx, val) {

                // Strip cookie data from the response headers.
                if (pathItem.name != 'Set-Cookie') {
                    var thisResponseTemplate = responseTemplate.clone();

                    thisResponseTemplate.find('.responseKey').html(val.name);
                    thisResponseTemplate.find('.responseValue').html(val.value);

                    thisResponseTemplate.appendTo(template.find('.pathResponseHeaders'));
                }
            });
        }
    },
    renderPathIcon: function (pathItem, template) {
        if (pathItem.type == 'client_redirect') {
            var redirectTypeIconString = pathItem.redirect_type.toUpperCase();

            if (pathItem.redirect_type == 'javascript') {
                redirectTypeIconString = 'JS';
            }

            template.find('.pathIcon').append('<span class="clientRedirectBadge ' + pathItem.redirect_type + 'Redirect">' + redirectTypeIconString + '</span>');
        }
    }
};

RedirectPathPopup.init();