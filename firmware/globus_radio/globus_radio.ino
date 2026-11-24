/*
 * Глобус-радио — Шаг 1: "звук есть"
 * Плата: ESP32-WROOM-32. Усилитель: аналоговый (PAM8403 и т.п.) через ВСТРОЕННЫЙ ЦАП.
 *
 * Цель шага — проверить всю аудио-цепочку:
 *   WiFi -> HTTP-поток MP3 -> декодер -> внутренний ЦАП -> усилитель -> динамик.
 * Положение глобуса (энкодеры AS5600) здесь ещё не участвует — это следующий шаг.
 *
 * Библиотека: ESP8266Audio (earlephilhower) — Arduino IDE -> Library Manager.
 * Плата в Arduino IDE: "ESP32 Dev Module".
 *
 * Подключение усилителя:
 *   GPIO26   -> вход усилителя (L / моно IN)
 *   GND      -> GND усилителя        (общая земля обязательна!)
 *   5V (VIN) -> VCC усилителя
 *   выход усилителя -> динамик(и)
 * Встроенный ЦАП ESP32 сидит на GPIO25/26 — пины фиксированы, менять нельзя.
 */

#include <WiFi.h>
#include <AudioGeneratorMP3.h>
#include <AudioFileSourceHTTPStream.h>
#include <AudioFileSourceBuffer.h>
#include <AudioOutputInternalDAC.h>

#include "wifi_secrets.h"

// Тестовые потоки: plain HTTP, без авторизации — надёжно для проверки железа.
// На Шаге 2 их заменит станция страны из radio-browser.
const char* STREAMS[] = {
  "http://ice1.somafm.com/groovesalad-128-mp3",  // SomaFM - Groove Salad
  "http://ice1.somafm.com/dronezone-128-mp3",    // SomaFM - Drone Zone
  "http://ice1.somafm.com/indiepop-128-mp3"      // SomaFM - Indie Pop Rocks
};
const int STREAM_COUNT = sizeof(STREAMS) / sizeof(STREAMS[0]);

int   currentStream = 0;
float gain = 0.6f;   // 0.0..~1.0; у 8-битного ЦАП выше 1.0 начинает хрипеть

AudioGeneratorMP3*         mp3  = nullptr;
AudioFileSourceHTTPStream* file = nullptr;
AudioFileSourceBuffer*     buff = nullptr;
AudioOutputInternalDAC*    out  = nullptr;

void startStream(int idx) {
  // остановить и освободить предыдущий поток
  if (mp3)  { if (mp3->isRunning()) mp3->stop(); delete mp3;  mp3  = nullptr; }
  if (buff) { delete buff; buff = nullptr; }
  if (file) { delete file; file = nullptr; }

  currentStream = (idx % STREAM_COUNT + STREAM_COUNT) % STREAM_COUNT;  // безопасный wrap
  Serial.printf("\n[>] Поток %d/%d: %s\n", currentStream + 1, STREAM_COUNT, STREAMS[currentStream]);

  file = new AudioFileSourceHTTPStream(STREAMS[currentStream]);
  file->SetReconnect(5, 500);                    // авто-переподключение при обрыве
  buff = new AudioFileSourceBuffer(file, 4096);  // буфер — меньше заиканий
  mp3  = new AudioGeneratorMP3();
  mp3->begin(buff, out);
}

void connectWifi() {
  Serial.printf("WiFi: подключаюсь к \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf(" OK, IP %s\n", WiFi.localIP().toString().c_str());
}

void printHelp() {
  Serial.println("\n=== Глобус-радио - Шаг 1 (звук есть) ===");
  Serial.println("Команды (Serial Monitor, 115200):");
  Serial.println("  n - следующая станция   p - предыдущая");
  Serial.println("  + - громче              - - тише");
  Serial.println("  ? - справка");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  printHelp();

  connectWifi();

  out = new AudioOutputInternalDAC();  // встроенный ЦАП ESP32 (GPIO25/26)
  out->SetOutputModeMono(true);        // моно-усилитель: дублируем сигнал
  out->SetGain(gain);

  startStream(0);
}

void loop() {
  // команды с Serial Monitor
  if (Serial.available()) {
    char c = Serial.read();
    switch (c) {
      case 'n': startStream(currentStream + 1); break;
      case 'p': startStream(currentStream - 1); break;
      case '+': gain = min(gain + 0.1f, 1.5f); out->SetGain(gain); Serial.printf("Громкость: %.1f\n", gain); break;
      case '-': gain = max(gain - 0.1f, 0.0f); out->SetGain(gain); Serial.printf("Громкость: %.1f\n", gain); break;
      case '?': printHelp(); break;
      default:  break;
    }
  }

  // прокрутка аудио
  if (mp3 && mp3->isRunning()) {
    if (!mp3->loop()) {                // поток оборвался/кончился
      mp3->stop();
      Serial.println("[!] Поток остановился — перезапуск через 1с");
      delay(1000);
      startStream(currentStream);
    }
  }
}
