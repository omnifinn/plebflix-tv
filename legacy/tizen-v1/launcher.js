/* Plebflix TV for Samsung Tizen TVs: the packaged launcher.
 * Tizen APIs only exist on pages inside the .wgt, so this page registers the remote keys the deck uses, then opens the
 * live deck at https://plebflix.com/tv/ (the site's own origin, so YouTube embeds see plebflix.com as their referrer).
 * BACK on the deck while watching goes back here, and coming back here closes the app.
 */
(function () {
  var DECK = "https://plebflix.com/tv/";
  var KEYS = ["ChannelUp", "ChannelDown", "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaFastForward",
    "MediaRewind", "MediaTrackNext", "MediaTrackPrevious", "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

  function exit() {
    try {
      tizen.application.getCurrentApplication().exit();
    } catch (e) {
      window.close();
    }
  }

  function register() {
    if (typeof tizen === "undefined" || !tizen.tvinputdevice) return;
    for (var i = 0; i < KEYS.length; i++) {
      try {
        tizen.tvinputdevice.registerKey(KEYS[i]);
      } catch (e) {
        /* key not on this remote */
      }
    }
  }

  var opened = false;
  try {
    opened = sessionStorage.getItem("plebflix-opened") === "1";
  } catch (e) {
    /* ignore */
  }
  // Shown again after the deck: the viewer pressed BACK while watching.
  if (opened) {
    exit();
    return;
  }
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) exit();
  });
  document.addEventListener("keydown", function (event) {
    if (event.keyCode === 10009) exit();
  });
  register();
  if (!navigator.onLine) {
    document.getElementById("msg").textContent = "NO SIGNAL";
    document.getElementById("sub").textContent = "Connect the TV to the internet and open Plebflix TV again.";
    return;
  }
  try {
    sessionStorage.setItem("plebflix-opened", "1");
  } catch (e) {
    /* ignore */
  }
  window.location.href = DECK;
})();
