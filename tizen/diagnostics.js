(function () {
  window.onerror = function (message, url, line, column) {
    console.error('Plebflix TV: ' + message + ' at ' + url + ':' + line + ':' + column);
  };
})();
