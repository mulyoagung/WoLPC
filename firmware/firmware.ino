#include <ESP8266WiFi.h>
#include <WiFiUDP.h>
#include "WakeOnLan.h" 
#include <ESP8266HTTPClient.h>
#include "PubSubClient.h"

#include "secrets.h"

// --- Configuration ---
const char* ssid = SECRET_SSID;
const char* portalUrl = SECRET_PORTAL_URL;
const char* mqttServer = "broker.hivemq.com";
const int mqttPort = 1883;

// Topic structure: nyalakanpc/[DEVICE_ID]/[SUBTOPIC]
String deviceId = "esp01_wol_01"; 
String cmdTopic = "nyalakanpc/" + deviceId + "/cmd";
String logTopic = "nyalakanpc/" + deviceId + "/logs";
String statusTopic = "nyalakanpc/" + deviceId + "/status";

// Accounts (Now stored in secrets.h)
const char* (&accounts)[SECRET_MAX_ACCOUNTS][2] = SECRET_ACCOUNTS;
int currentAccount = 0;
int maxAccounts = SECRET_MAX_ACCOUNTS;

WiFiClient espClient;
PubSubClient client(espClient);
WiFiUDP udp;
WakeOnLan WOL(udp);

void sendLog(String msg) {
  Serial.println(msg);
  if (client.connected()) {
    client.publish(logTopic.c_str(), msg.c_str());
  }
}

bool checkInternet() {
  HTTPClient http;
  http.begin(espClient, "http://connectivitycheck.gstatic.com/generate_204");
  int httpCode = http.GET();
  http.end();
  return (httpCode == 204);
}

bool loginToPortal(const char* user, const char* pass) {
  sendLog("Attempting login with: " + String(user));
  
  HTTPClient http;
  http.begin(espClient, portalUrl);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  
  // Note: Common form fields are 'username' and 'password'. 
  // You might need to adjust these based on the actual hs.univet.id form.
  String postData = "username=" + String(user) + "&password=" + String(pass) + "&dst=&popup=true";
  
  int httpCode = http.POST(postData);
  String payload = http.getString();
  http.end();
  
  if (httpCode > 0) {
    sendLog("Portal response code: " + String(httpCode));
    // Check if login was successful (usually redirects or 200 OK)
    delay(2000); // Wait for portal to process
    return checkInternet();
  }
  return false;
}

void setupWiFi() {
  delay(10);
  sendLog("\nConnecting to " + String(ssid));
  WiFi.begin(ssid);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  sendLog("WiFi connected. IP: " + WiFi.localIP().toString());
  
  // Handle Captive Portal
  if (!checkInternet()) {
    sendLog("No internet detected. Attempting portal login...");
    bool loggedIn = false;
    for (int i = 0; i < maxAccounts; i++) {
        if (loginToPortal(accounts[i][0], accounts[i][1])) {
            sendLog("Login SUCCESS with account " + String(accounts[i][0]));
            loggedIn = true;
            break;
        } else {
            sendLog("Login FAILED with account " + String(accounts[i][0]));
        }
    }
    if (!loggedIn) sendLog("CRITICAL: Failed to login to portal with any account!");
  } else {
    sendLog("Internet access available.");
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  sendLog("Message arrived [" + String(topic) + "]: " + message);

  if (String(topic) == cmdTopic) {
    if (message.startsWith("WAKE|")) {
      String mac = message.substring(5);
      
      // Calculate broadcast address dynamically based on current IP/Subnet
      IPAddress ip = WiFi.localIP();
      IPAddress subnet = WiFi.subnetMask();
      IPAddress broadcast = WOL.calculateBroadcastAddress(ip, subnet);
      
      sendLog("Waking device: " + mac);
      sendLog("Network: IP=" + ip.toString() + " mask=" + subnet.toString());
      sendLog("Using Broadcast: " + broadcast.toString());
      
      WOL.setBroadcastAddress(broadcast);
      WOL.sendMagicPacket(mac.c_str());
      
      // Also send to 255.255.255.255 just in case
      WOL.setBroadcastAddress(IPAddress(255, 255, 255, 255));
      WOL.sendMagicPacket(mac.c_str());
      
      sendLog("WOL packets sent to directed and global broadcast.");
    }
  }
}

void reconnect() {
  while (!client.connected()) {
    sendLog("Attempting MQTT connection...");
    if (client.connect(deviceId.c_str(), statusTopic.c_str(), 1, true, "offline")) {
      sendLog("MQTT Connected");
      client.subscribe(cmdTopic.c_str());
      client.publish(statusTopic.c_str(), "online", true); 
    } else {
      sendLog("failed, rc=" + String(client.state()) + ". Try again in 5s");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  setupWiFi();
  client.setServer(mqttServer, mqttPort);
  client.setCallback(callback);
  client.setKeepAlive(60); 
  WOL.setRepeat(10, 50);   // More repeats, shorter delay
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  
  static unsigned long lastStatus = 0;
  static unsigned long lastInternetCheck = 0;

  // --- HEARTBEAT: Kirim status online setiap 30 detik ---
  if (millis() - lastStatus > 30000) {
    if (client.connected()) {
      client.publish(statusTopic.c_str(), "online", true);
    }
    lastStatus = millis();
  }

  // Check internet every 2 minutes (lebih cepat dari sebelumnya 5 menit)
  if (millis() - lastInternetCheck > 120000) {
    if (!checkInternet()) {
        sendLog("Internet lost. Re-logging...");
        setupWiFi(); 
    }
    lastInternetCheck = millis();
  }
}
