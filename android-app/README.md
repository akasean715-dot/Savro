# SAVRO Android app

This is a separate Capacitor Android wrapper. It uses a copy of the existing customer app in `www/`, so the main website source files are kept separate.

## App identity
- App name: SAVRO
- Android application ID: `online.thedigitalstorefront.savro`
- API server: `https://savro.thedigitalstorefront.online`

## Before building
1. Install Node.js 22 or newer.
2. Install Android Studio and an Android SDK.
3. In Render, open the **Savro** service > **Environment**.
4. Add `CORS_ORIGIN` with this value if it is not already set:

   ```text
   https://savro.thedigitalstorefront.online,https://localhost
   ```

   If `CORS_ORIGIN` already exists, preserve other origins you need and add both of these. Do not replace the website origin with localhost alone. The current `server.js` only enables its CORS allow-list when this variable is set.
5. Save the Render environment change and wait for the service to redeploy before testing.

## Create the native Android project (first time only)
Open PowerShell in this `android-app` folder:

```powershell
npm install
npx cap add android
npx cap sync android
npx cap open android
```

`npx cap add android` is a one-time command. For later updates:

```powershell
npx cap sync android
npx cap open android
```

## Build outputs
In Android Studio:
- Test on a real Android device first.
- For direct distribution, use **Build > Generate Signed Bundle / APK > APK**.
- For Google Play, use **Build > Generate Signed Bundle / APK > Android App Bundle (AAB)**.

Keep the signing keystore and passwords private and backed up. Never commit or share them.

## App icon
`resources/savro-icon-source.png` is a square crop of the existing SAVRO logo mark. Use Android Studio's **Image Asset** tool to create the launcher icon from it after generating the Android project.

## Integration notes
- The Android copy of `www/app.js` sends `/api/...` requests to the production backend. If the backend domain changes, update `SAVRO_API_BASE` at the top of that file.
- The website's `public/app.js`, `public/app/index.html`, `server.js`, database schema, Razorpay integration, and support backend are not rewritten by this Android wrapper.
- The existing server issues seven-day JWTs; this setup does not change session lifetime.
- Test login, registration, password-reset OTP, dashboard, invoices, inventory, logo upload, Razorpay checkout, support links, and print/export on a physical device before release. Verify print/share behavior on Android; desktop browser printing is not proof of Android print support.
- This ZIP contains Android wrapper source, not a signed APK or Play Store AAB. Android Studio must generate those build artifacts.
