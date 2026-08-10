/*
 * export-signing-key.js - one-time export of the PixInsight signing key.
 *
 * Run this ONCE inside PixInsight (Script Editor, F9). It decrypts the .xssk
 * with your password and writes the key material to
 *
 *    ~/.pixinsight-mcp/signing-key.json
 *
 * after which module/sign.mjs signs modules with no PixInsight involved, and
 * the same key can be put in CI secrets so releases sign themselves.
 *
 * Security: the exported file holds the private key in the clear, with the
 * password protection removed. Treat it exactly as you would the password:
 * anyone holding it can sign as you. It is written with the platform's default
 * permissions, PJSR has no way to restrict them, so on a shared machine
 * tighten them yourself (icacls / chmod 600).
 *
 * PixInsight is needed only for this step. Security.loadSigningKeysFile() is
 * what performs the decryption; nothing else can, the .xssk KDF is unpublished.
 */

#include <pjsr/Sizer.jsh>

function env( name )
{
   try
   {
      if ( typeof System != "undefined" && System.getEnvironmentVariable )
         return System.getEnvironmentVariable( name );
      if ( typeof getEnvironmentVariable != "undefined" )
         return getEnvironmentVariable( name );
   }
   catch ( x )
   {
      // No environment is a supported case: the dialogs below cover it.
   }
   return null;
}

var HOME = env( "USERPROFILE" ) || env( "HOME" ) || "";
var OUT_DIR = HOME + "/.pixinsight-mcp";
var OUT_FILE = OUT_DIR + "/signing-key.json";

function promptPassword( keysFile )
{
   let dialog = new Dialog;
   dialog.windowTitle = "Export signing key";

   dialog.info_Label = new Label( dialog );
   dialog.info_Label.text = "Password for " + keysFile;

   dialog.password_Edit = new Edit( dialog );
   dialog.password_Edit.passwordMode = true;
   dialog.password_Edit.setScaledFixedWidth( 260 );

   dialog.ok_Button = new PushButton( dialog );
   dialog.ok_Button.text = "OK";
   dialog.ok_Button.onClick = function() { dialog.ok(); };

   dialog.cancel_Button = new PushButton( dialog );
   dialog.cancel_Button.text = "Cancel";
   dialog.cancel_Button.onClick = function() { dialog.cancel(); };

   dialog.buttons_Sizer = new HorizontalSizer;
   dialog.buttons_Sizer.spacing = 6;
   dialog.buttons_Sizer.addStretch();
   dialog.buttons_Sizer.add( dialog.ok_Button );
   dialog.buttons_Sizer.add( dialog.cancel_Button );

   dialog.sizer = new VerticalSizer;
   dialog.sizer.margin = 8;
   dialog.sizer.spacing = 6;
   dialog.sizer.add( dialog.info_Label );
   dialog.sizer.add( dialog.password_Edit );
   dialog.sizer.add( dialog.buttons_Sizer );
   dialog.adjustToContents();

   return dialog.execute() ? dialog.password_Edit.text : null;
}

function selectKeysFile()
{
   let fromEnv = env( "PI_SIGN_KEYS" );
   if ( fromEnv && File.exists( fromEnv ) )
      return fromEnv;

   let dialog = new OpenFileDialog;
   dialog.caption = "Select your PixInsight signing keys file";
   dialog.multipleSelections = false;
   dialog.filters = [["PixInsight signing keys", "*.xssk"], ["All files", "*"]];
   return dialog.execute() ? dialog.fileName : null;
}

function main()
{
   let keysFile = selectKeysFile();
   if ( !keysFile )
   {
      (new MessageBox( "No keys file selected.", "Export signing key" )).execute();
      return;
   }

   let password = env( "PI_SIGN_PASSWORD" ) || promptPassword( keysFile );
   if ( !password )
      return;

   let keys;
   try
   {
      keys = Security.loadSigningKeysFile( keysFile, password );
   }
   catch ( x )
   {
      (new MessageBox( "Could not load the keys file:\n" + x.toString(), "Export signing key" )).execute();
      return;
   }
   if ( !keys.valid )
   {
      (new MessageBox( "Invalid signing keys file (wrong password?).", "Export signing key" )).execute();
      return;
   }

   if ( !File.directoryExists( OUT_DIR ) )
      File.createDirectory( OUT_DIR );

   // The private key comes out in EXPANDED form (clamped scalar then nonce
   // prefix), not as a seed, which is why signing needs module/ed25519.mjs
   // rather than node:crypto.
   let exported = {
      developerId: keys.developerId,
      expandedKeyHex: keys.privateKey.toHex(),
      publicKeyHex: keys.publicKey.toHex(),
      exportedBy: "module/export-signing-key.js",
   };
   File.writeTextFile( OUT_FILE, JSON.stringify( exported, null, 2 ) + "\n" );

   keys.publicKey.secureFill();
   keys.privateKey.secureFill();

   (new MessageBox( "Signing key exported to:\n" + OUT_FILE +
                    "\n\ndeveloperId: " + exported.developerId +
                    "\n\nThis file contains your private key with no password protection. " +
                    "Anyone who has it can sign as you.",
                    "Export signing key" )).execute();
}

main();
