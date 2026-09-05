import UIKit
import AuthenticationServices
import StoreKit
import Capacitor
import FirebaseCore
import FirebaseAuth

private enum PendingDeepLink {
    static let key = "com.chiaki.dmmanager.pendingDeepLinkUrl"
    static let inviteHosts = ["dm-management-ecc1f.web.app", "dm-management-ecc1f.firebaseapp.com"]

    static func shouldHandle(_ url: URL) -> Bool {
        if url.scheme == "dmmanager" {
            return true
        }
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host,
              inviteHosts.contains(host) else {
            return false
        }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .contains(where: { $0.name == "team_join" }) == true
    }

    static func save(_ url: URL) {
        guard shouldHandle(url) else { return }
        UserDefaults.standard.set(url.absoluteString, forKey: key)
    }

    static func consume() -> String? {
        let url = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        return url
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        PendingDeepLink.save(url)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            PendingDeepLink.save(url)
        }
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

@objc(DeepLink)
public class DeepLink: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeepLink"
    public let jsName = "DeepLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consumePendingUrl", returnType: CAPPluginReturnPromise),
    ]

    @objc public func consumePendingUrl(_ call: CAPPluginCall) {
        call.resolve([
            "url": PendingDeepLink.consume() ?? NSNull()
        ])
    }
}

@objc(SignInWithApple)
public class SignInWithApple: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "SignInWithApple"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareAuthorizationRevocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "revokeAuthorizationCode", returnType: CAPPluginReturnPromise),
    ]

    private let callbackIdKey = "com.chiaki.dmmanager.signinwithapple.callbackId"
    private var preparedRevocationUid: String?

    @objc public func authorize(_ call: CAPPluginCall) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = requestedScopes(from: call)
        request.state = call.getString("state")
        request.nonce = call.getString("nonce")

        UserDefaults.standard.setValue(call.callbackId, forKey: callbackIdKey)
        self.bridge?.saveCall(call)

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    @objc public func revokeAuthorizationCode(_ call: CAPPluginCall) {
        guard let authorizationCode = call.getString("authorizationCode")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !authorizationCode.isEmpty else {
            DispatchQueue.main.async {
                call.reject("Apple authorization could not be revoked.")
            }
            return
        }
        guard let currentUser = Auth.auth().currentUser,
              let preparedRevocationUid,
              currentUser.uid == preparedRevocationUid else {
            DispatchQueue.main.async {
                call.reject("Apple authorization could not be revoked.")
            }
            return
        }
        self.preparedRevocationUid = nil

        Task {
            do {
                try await Auth.auth().revokeToken(withAuthorizationCode: authorizationCode)
                DispatchQueue.main.async {
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Apple authorization could not be revoked.")
                }
            }
        }
    }

    @objc public func prepareAuthorizationRevocation(_ call: CAPPluginCall) {
        preparedRevocationUid = nil
        guard let identityToken = call.getString("identityToken")?.trimmingCharacters(in: .whitespacesAndNewlines),
              let rawNonce = call.getString("rawNonce")?.trimmingCharacters(in: .whitespacesAndNewlines),
              let expectedUid = call.getString("expectedUid")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !identityToken.isEmpty,
              !rawNonce.isEmpty,
              !expectedUid.isEmpty else {
            DispatchQueue.main.async {
                call.reject("Apple authorization could not be prepared.")
            }
            return
        }

        let credential = OAuthProvider.credential(
            providerID: .apple,
            idToken: identityToken,
            rawNonce: rawNonce
        )
        Task {
            do {
                let result = try await Auth.auth().signIn(with: credential)
                guard result.user.uid == expectedUid else {
                    try? Auth.auth().signOut()
                    DispatchQueue.main.async {
                        call.reject("Apple authorization could not be prepared.")
                    }
                    return
                }
                DispatchQueue.main.async {
                    self.preparedRevocationUid = expectedUid
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Apple authorization could not be prepared.")
                }
            }
        }
    }

    private func requestedScopes(from call: CAPPluginCall) -> [ASAuthorization.Scope]? {
        var scopes: [ASAuthorization.Scope] = []
        if let scopesStr = call.getString("scopes") {
            if scopesStr.contains("name") {
                scopes.append(.fullName)
            }
            if scopesStr.contains("email") {
                scopes.append(.email)
            }
        }
        return scopes.isEmpty ? nil : scopes
    }

    private func jsonValue(_ value: String?) -> Any {
        value ?? NSNull()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
           let window = scene.windows.first(where: { $0.isKeyWindow }) {
            return window
        }
        return ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential else { return }
        let defaults = UserDefaults.standard
        let id = defaults.string(forKey: callbackIdKey) ?? ""
        guard let call = bridge?.savedCall(withID: id) else { return }

        let identityToken = appleIDCredential.identityToken.flatMap { String(data: $0, encoding: .utf8) }
        let authorizationCode = appleIDCredential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        guard let identityToken, let authorizationCode else {
            call.reject("Unable to read Apple identity token")
            bridge?.releaseCall(call)
            return
        }

        let result: [String: Any] = [
            "response": [
                "user": appleIDCredential.user,
                "email": jsonValue(appleIDCredential.email),
                "givenName": jsonValue(appleIDCredential.fullName?.givenName),
                "familyName": jsonValue(appleIDCredential.fullName?.familyName),
                "identityToken": identityToken,
                "authorizationCode": authorizationCode
            ]
        ]

        call.resolve(result)
        bridge?.releaseCall(call)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let defaults = UserDefaults.standard
        let id = defaults.string(forKey: callbackIdKey) ?? ""
        guard let call = bridge?.savedCall(withID: id) else { return }
        call.reject(error.localizedDescription)
        bridge?.releaseCall(call)
    }
}

@objc(AppReview)
public class AppReview: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppReview"
    public let jsName = "AppReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
    ]

    @objc public func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }
}
