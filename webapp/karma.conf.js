// Karma configuration file, see link for more information
// https://karma-runner.github.io/1.0/config/configuration-file.html

const { existsSync } = require('fs');

// karma-chrome-launcher only looks for a handful of names on PATH, and the
// browser is somewhere different in each of the three places this suite runs:
// a developer's machine, a container that carries Playwright's chromium, and a
// CI runner with Google Chrome installed. Finding it here means `npm run
// test:ci` behaves the same in all three rather than failing in whichever one
// nobody tried.
if (!process.env.CHROME_BIN) {
  const kandidaten = [
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  const gefunden = kandidaten.find(pfad => existsSync(pfad));
  if (gefunden) {
    process.env.CHROME_BIN = gefunden;
  }
}

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma')
    ],
    client: {
      jasmine: {
        // you can add configuration options for Jasmine here
        // the possible options are listed at https://jasmine.github.io/api/edge/Configuration.html
        // for example, you can disable the random execution with `random: false`
        // or set a specific seed with `seed: 4321`
      },
      clearContext: false // leave Jasmine Spec Runner output visible in browser
    },
    jasmineHtmlReporter: {
      suppressAll: true // removes the duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/app'),
      subdir: '.',
      reporters: [
        { type: 'html' },
        { type: 'text-summary' }
      ]
    },
    reporters: ['progress', 'kjhtml'],
    // Containers and CI run as root, where Chrome refuses to start its sandbox.
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
      }
    },
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    singleRun: false,
    restartOnFileChange: true
  });
};
