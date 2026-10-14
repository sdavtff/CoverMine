package com.davi.voxelcraft;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Wrapper WebView do VoxelCraft. O jogo (HTML/JS/Three.js) fica em app/src/main/assets
 * e é servido a partir de https://appassets.androidplatform.net/assets/ para que os
 * módulos ES e o localStorage funcionem com uma origem segura.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("png", "image/png");
        MIME.put("json", "application/json");
    }

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // multiplayer em rede local (ws://) a partir da página https:// do app
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }
        });
        setContentView(web);
        hideSystemUi();
        web.loadUrl("https://" + HOST + "/assets/index.html");
    }

    private WebResourceResponse serveAsset(Uri uri) {
        if (!HOST.equals(uri.getHost())) return null;
        String path = uri.getPath();
        if (path == null || !path.startsWith("/assets/")) return null;
        path = path.substring("/assets/".length());
        try {
            InputStream in = getAssets().open(path);
            String ext = path.substring(path.lastIndexOf('.') + 1);
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            WebResourceResponse r = new WebResourceResponse(mime, "utf-8", in);
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemUi();
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.saveGame && window.saveGame()", null);
        web.onPause();
        super.onPause();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.onAndroidBack && window.onAndroidBack()", null);
    }
}
