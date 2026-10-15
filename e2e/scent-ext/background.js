// A stand-in for another extension, for the E2E test only. run.mjs installs
// it twice: once with the id foxscope@pooriaarab and once with another id.
// It forwards a SCENT message from the test page to foxprefs and reports
// what came back, or that the call failed.
browser.runtime.onMessage.addListener(async ({ to, message }) => {
  try {
    return { sent: true, value: await browser.runtime.sendMessage(to ?? "foxprefs@pooriaarab", message) };
  } catch (error) {
    return { sent: false, error: error.message };
  }
});
