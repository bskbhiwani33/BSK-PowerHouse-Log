// Keep Netlify active until Firebase Functions have been deployed and tested.
window.BSK_API_CONFIG = Object.freeze({
  mode: "netlify",
  firebaseEndpoints: Object.freeze({
    login: "https://asia-south1-testing-app-8af35.cloudfunctions.net/login",
    admin: "https://asia-south1-testing-app-8af35.cloudfunctions.net/admin",
    records: "https://asia-south1-testing-app-8af35.cloudfunctions.net/records"
  })
});
