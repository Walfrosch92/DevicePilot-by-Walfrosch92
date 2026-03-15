// Ulanzi Stream Deck Plugin SDK - Event Constants
// Protocol Version: V1.2.2

const Events = Object.freeze({
  CONNECTED:      'connected',
  CLOSE:          'close',
  ERROR:          'error',
  ADD:            'add',
  RUN:            'run',
  PARAMFROMAPP:   'paramfromapp',
  PARAMFROMPLUGIN:'paramfromplugin',
  SETACTIVE:      'setactive',
  CLEAR:          'clear',
  TOAST:          'toast',
  STATE:          'state',
  OPENURL:        'openurl',
  OPENVIEW:       'openview',
  SELECTDIALOG:   'selectdialog'
});

const SocketErrors = { DEFAULT: 'closed *****' };
