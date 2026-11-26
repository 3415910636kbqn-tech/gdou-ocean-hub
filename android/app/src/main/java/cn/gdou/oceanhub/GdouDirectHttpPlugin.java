package cn.gdou.oceanhub;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pure zero-retention direct HTTP bridge for GDOU official hosts (*.gdou.edu.cn).
 * Runs directly from the student's own Android device IP, never caches to disk,
 * disables automatic redirects so TypeScript controls WFW redirect healing & RAM cookies.
 */
@CapacitorPlugin(name = "GdouDirectHttp")
public class GdouDirectHttpPlugin extends Plugin {
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    private boolean isAllowedGdouHost(String host) {
        if (host == null) return false;
        String lower = host.toLowerCase(Locale.ROOT);
        return lower.equals("gdou.edu.cn") || lower.endsWith(".gdou.edu.cn");
    }

    @PluginMethod
    public void request(PluginCall call) {
        String rawUrl = call.getString("url");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("Missing url");
            return;
        }
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        JSObject reqHeaders = call.getObject("headers", new JSObject());
        String body = call.getString("body");
        int timeoutMs = call.getInt("timeoutMs", 20000);

        EXECUTOR.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(rawUrl);
                if (!"https".equalsIgnoreCase(url.getProtocol())) {
                    call.reject("Only HTTPS is allowed");
                    return;
                }
                if (!isAllowedGdouHost(url.getHost())) {
                    call.reject("Host not allowed: " + url.getHost());
                    return;
                }

                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(method);
                conn.setInstanceFollowRedirects(false);
                conn.setUseCaches(false);
                conn.setConnectTimeout(timeoutMs);
                conn.setReadTimeout(timeoutMs);

                if (reqHeaders != null) {
                    Iterator<String> keys = reqHeaders.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String val = reqHeaders.getString(key);
                        if (val != null) {
                            conn.setRequestProperty(key, val);
                        }
                    }
                }

                if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload);
                        os.flush();
                    }
                }

                int status = conn.getResponseCode();
                InputStream is = (status >= 400) ? conn.getErrorStream() : conn.getInputStream();
                byte[] respBytes = new byte[0];
                if (is != null) {
                    try (InputStream stream = is; ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = stream.read(buf)) != -1) {
                            baos.write(buf, 0, n);
                        }
                        respBytes = baos.toByteArray();
                    }
                }

                JSObject respHeaders = new JSObject();
                JSArray setCookies = new JSArray();
                Map<String, List<String>> headerFields = conn.getHeaderFields();
                if (headerFields != null) {
                    for (Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
                        String key = entry.getKey();
                        List<String> values = entry.getValue();
                        if (key == null || values == null || values.isEmpty()) continue;
                        if (key.equalsIgnoreCase("Set-Cookie")) {
                            for (String sc : values) {
                                setCookies.put(sc);
                            }
                        } else {
                            respHeaders.put(key.toLowerCase(Locale.ROOT), values.get(0));
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("url", rawUrl);
                ret.put("headers", respHeaders);
                ret.put("setCookies", setCookies);
                ret.put("bodyBase64", Base64.encodeToString(respBytes, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("Network error: " + ex.getMessage(), ex);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }
}
