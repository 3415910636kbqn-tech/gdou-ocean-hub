import UIKit
import Capacitor
import Foundation

private final class GdouNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Return nil so TypeScript NativeEphemeralCookieJar captures every Set-Cookie and heals WFW redirects
        completionHandler(nil)
    }
}

@objc(GdouDirectHttpPlugin)
public class GdouDirectHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GdouDirectHttpPlugin"
    public let jsName = "GdouDirectHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    private let noRedirectDelegate = GdouNoRedirectDelegate()

    private func isAllowedGdouHost(_ host: String?) -> Bool {
        guard let h = host?.lowercased() else { return false }
        return h == "gdou.edu.cn" || h.hasSuffix(".gdou.edu.cn")
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let rawUrl = call.getString("url"), let url = URL(string: rawUrl) else {
            call.reject("Invalid url")
            return
        }
        guard url.scheme?.lowercased() == "https" else {
            call.reject("Only HTTPS is allowed")
            return
        }
        guard isAllowedGdouHost(url.host) else {
            call.reject("Host not allowed")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        let headersObj = call.getObject("headers") ?? [:]
        let bodyStr = call.getString("body")
        let timeoutSec = Double(call.getInt("timeoutMs") ?? 20000) / 1000.0

        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeoutSec)
        req.httpMethod = method
        req.httpShouldHandleCookies = false

        for (k, v) in headersObj {
            if let strVal = v as? String {
                req.setValue(strVal, forHTTPHeaderField: k)
            }
        }

        if let bodyStr = bodyStr, method != "GET", method != "HEAD" {
            req.httpBody = bodyStr.data(using: .utf8)
        }

        // Pure ephemeral RAM-only session (zero disk cookies, zero HTTP cache)
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpShouldSetCookies = false
        cfg.httpCookieStorage = nil
        cfg.urlCache = nil
        cfg.timeoutIntervalForRequest = timeoutSec
        cfg.timeoutIntervalForResource = timeoutSec

        let session = URLSession(configuration: cfg, delegate: noRedirectDelegate, delegateQueue: nil)
        let task = session.dataTask(with: req) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            if let err = error {
                call.reject("Network error: \(err.localizedDescription)", nil, err)
                return
            }
            guard let httpResp = response as? HTTPURLResponse else {
                call.reject("Invalid HTTP response")
                return
            }

            var respHeaders: [String: String] = [:]
            var stringHeaderMap: [String: String] = [:]
            for (k, v) in httpResp.allHeaderFields {
                let keyStr = String(describing: k)
                let valStr = String(describing: v)
                stringHeaderMap[keyStr] = valStr
                if keyStr.lowercased() != "set-cookie" {
                    respHeaders[keyStr.lowercased()] = valStr
                }
            }

            // Use Foundation HTTPCookie parser to safely split multiple Set-Cookie headers containing Expires commas
            let parsedCookies = HTTPCookie.cookies(withResponseHeaderFields: stringHeaderMap, for: url)
            var setCookies: [String] = []
            for c in parsedCookies {
                var parts = ["\(c.name)=\(c.value)"]
                parts.append("Path=\(c.path)")
                if !c.domain.isEmpty {
                    parts.append("Domain=\(c.domain)")
                }
                if c.isSecure {
                    parts.append("Secure")
                }
                if let exp = c.expiresDate, exp.timeIntervalSinceNow <= 0 {
                    parts.append("Max-Age=0")
                }
                setCookies.append(parts.joined(separator: "; "))
            }

            let bodyBase64 = (data ?? Data()).base64EncodedString()
            call.resolve([
                "status": httpResp.statusCode,
                "url": rawUrl,
                "headers": respHeaders,
                "setCookies": setCookies,
                "bodyBase64": bodyBase64
            ])
        }
        task.resume()
    }
}

class GdouBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GdouDirectHttpPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GdouBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
