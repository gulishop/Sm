/**
 * thermal-printer.js
 * ESC/POS Thermal Printer — Web Bluetooth + WebUSB
 * Auto paper 58/80, minimal feed, QR code support
 */

class ThermalPrinter {
  constructor(options = {}) {
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.usbDevice = null;
    this.usbInterface = null;
    this.usbEndpoint = null;
    this.connectionType = null;
    this.isConnected = false;

    // Saved preference (user / last detect)
    const savedW = Number(localStorage.getItem("sm_printer_width") || 0);

    this.paperWidth = options.paperWidth || savedW || 58; // PT-210 default 58
    this.charsPerLine = this.paperWidth <= 58 ? 32 : 48;
    this.chunkSize = options.chunkSize || 48;
    this.chunkDelay = options.chunkDelay || 40;
    this.feedBeforeCut = options.feedBeforeCut != null ? options.feedBeforeCut : 2; // tear ke liye 2 lines
    this.usePartialCut = options.usePartialCut !== false;
    this.skipCut = options.skipCut === true; // true = cut mat karo, sirf feed
    this.debug = options.debug || false;

    this.SERVICE_UUIDS = [
      "000018f0-0000-1000-8000-00805f9b34fb",
      "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
      "49535343-fe7d-4ae5-8fa9-9fafd205e455",
      "0000ff00-0000-1000-8000-00805f9b34fb",
      "0000ae30-0000-1000-8000-00805f9b34fb",
      "0000fff0-0000-1000-8000-00805f9b34fb",
      "0000ffe0-0000-1000-8000-00805f9b34fb",
      "0000ff10-0000-1000-8000-00805f9b34fb"
    ];

    this.WRITE_CHAR_UUIDS = [
      "00002af1-0000-1000-8000-00805f9b34fb",
      "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
      "49535343-8841-43f4-a8d4-ecbe34729bb3",
      "0000ff02-0000-1000-8000-00805f9b34fb",
      "0000ae01-0000-1000-8000-00805f9b34fb",
      "0000fff1-0000-1000-8000-00805f9b34fb",
      "0000fff2-0000-1000-8000-00805f9b34fb",
      "0000ffe1-0000-1000-8000-00805f9b34fb",
      "0000ff11-0000-1000-8000-00805f9b34fb"
    ];
  }

  log(...args) {
    if (this.debug) console.log("[Printer]", ...args);
  }

  /** Device name se 58 vs 80 guess */
  autoDetectPaperWidth(deviceName) {
    const n = String(deviceName || "").toLowerCase();
    // Common 58mm portable models
    const is58 =
      /pt-?210|pt-?280|pt-?260|mtp-?2|mtp-?3|58mm|goojprt|hiliabel|hilabel|mpt-|pos-?580|xp-?58|rpp0?2|rpp0?3/.test(n);
    const is80 =
      /80mm|tm-?t20|tm-?t82|xp-?80|pos-?80|rpp0?8/.test(n);

    if (is58) this.setSettings({ paperWidth: 58 });
    else if (is80) this.setSettings({ paperWidth: 80 });
    // else keep current / saved

    localStorage.setItem("sm_printer_width", String(this.paperWidth));
    this.log("Paper width set to", this.paperWidth, "mm from name:", deviceName);
    return this.paperWidth;
  }

  /* ===================== CONNECT ===================== */

  async connect() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    let choice = "bluetooth";

    if (navigator.usb && !isMobile) {
      const useUsb = confirm(
        "Printer kaise connect karna hai?\n\n" +
          "OK  = USB\n" +
          "Cancel = Bluetooth"
      );
      choice = useUsb ? "usb" : "bluetooth";
    } else if (!navigator.bluetooth && navigator.usb) {
      choice = "usb";
    }

    if (choice === "usb") return await this.connectUSB();
    return await this.connectBluetooth();
  }

  async connectBluetooth() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth support nahi hai.\nChrome/Edge (Android) use karo.");
    }

    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: this.SERVICE_UUIDS
    });

    this.server = await this.device.gatt.connect();
    let found = false;

    for (const su of this.SERVICE_UUIDS) {
      try {
        const service = await this.server.getPrimaryService(su);
        for (const cu of this.WRITE_CHAR_UUIDS) {
          try {
            const char = await service.getCharacteristic(cu);
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              found = true;
              break;
            }
          } catch (e) {}
        }
        if (found) break;
      } catch (e) {}
    }

    if (!found) {
      const services = await this.server.getPrimaryServices();
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              found = true;
              break;
            }
          }
        } catch (e) {}
        if (found) break;
      }
    }

    if (!found) throw new Error("Printer write characteristic nahi mili.");

    this.connectionType = "bluetooth";
    this.isConnected = true;
    const name = this.device.name || "Bluetooth Printer";
    this.autoDetectPaperWidth(name);

    this.device.addEventListener("gattserverdisconnected", () => {
      this.isConnected = false;
    });

    return name + " · " + this.paperWidth + "mm";
  }

  async connectUSB() {
    if (!navigator.usb) throw new Error("WebUSB support nahi hai.");

    this.usbDevice = await navigator.usb
      .requestDevice({ filters: [{ classCode: 7 }] })
      .catch(async () => navigator.usb.requestDevice({ filters: [] }));

    await this.usbDevice.open();
    if (this.usbDevice.configuration === null) {
      await this.usbDevice.selectConfiguration(1);
    }

    let iface = null;
    let endpoint = null;

    for (const config of this.usbDevice.configurations) {
      for (const inter of config.interfaces) {
        for (const alt of inter.alternates) {
          if (alt.interfaceClass === 7 || alt.interfaceClass === 255 || alt.interfaceClass === 0) {
            for (const ep of alt.endpoints) {
              if (ep.direction === "out" && (ep.type === "bulk" || ep.type === "interrupt")) {
                iface = inter;
                endpoint = ep;
                break;
              }
            }
          }
          if (endpoint) break;
        }
        if (endpoint) break;
      }
      if (endpoint) break;
    }

    if (!endpoint) {
      for (const config of this.usbDevice.configurations) {
        for (const inter of config.interfaces) {
          for (const alt of inter.alternates) {
            for (const ep of alt.endpoints) {
              if (ep.direction === "out") {
                iface = inter;
                endpoint = ep;
                break;
              }
            }
            if (endpoint) break;
          }
          if (endpoint) break;
        }
        if (endpoint) break;
      }
    }

    if (!iface || !endpoint) {
      await this.usbDevice.close().catch(() => {});
      throw new Error("USB printer endpoint nahi mila.");
    }

    await this.usbDevice.claimInterface(iface.interfaceNumber);
    this.usbInterface = iface;
    this.usbEndpoint = endpoint;
    this.connectionType = "usb";
    this.isConnected = true;
    this.device = this.usbDevice;

    const name =
      this.usbDevice.productName || this.usbDevice.manufacturerName || "USB Printer";
    this.autoDetectPaperWidth(name);
    return name + " · " + this.paperWidth + "mm";
  }

  async disconnect() {
    try {
      if (this.connectionType === "bluetooth" && this.device?.gatt?.connected) {
        await this.device.gatt.disconnect();
      }
      if (this.connectionType === "usb" && this.usbDevice) {
        if (this.usbInterface != null) {
          await this.usbDevice.releaseInterface(this.usbInterface.interfaceNumber).catch(() => {});
        }
        await this.usbDevice.close().catch(() => {});
      }
    } catch (e) {
      this.log("Disconnect error", e);
    }
    this.isConnected = false;
    this.connectionType = null;
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.usbDevice = null;
    this.usbInterface = null;
    this.usbEndpoint = null;
  }

  /* ===================== WRITE ===================== */

  async write(data) {
    if (!this.isConnected) throw new Error("Printer connected nahi hai");
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (this.connectionType === "bluetooth") await this._writeBluetooth(buffer);
    else if (this.connectionType === "usb") await this._writeUSB(buffer);
    else throw new Error("Unknown connection type");
  }

  async _writeBluetooth(buffer) {
    for (let i = 0; i < buffer.length; i += this.chunkSize) {
      const chunk = buffer.slice(i, i + this.chunkSize);
      try {
        if (this.characteristic.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValue(chunk);
        }
      } catch (e) {
        await this.characteristic.writeValue(chunk);
      }
      if (i + this.chunkSize < buffer.length) {
        await new Promise((r) => setTimeout(r, this.chunkDelay));
      }
    }
  }

  async _writeUSB(buffer) {
    for (let i = 0; i < buffer.length; i += this.chunkSize) {
      const chunk = buffer.slice(i, i + this.chunkSize);
      await this.usbDevice.transferOut(this.usbEndpoint.endpointNumber, chunk);
      if (i + this.chunkSize < buffer.length) {
        await new Promise((r) => setTimeout(r, this.chunkDelay));
      }
    }
  }

  /** Manual paper width switch — call from a settings button */
  setPaperWidth(mm) {
    const w = Number(mm) === 80 ? 80 : 58; // sirf 58 ya 80 allowed
    this.setSettings({ paperWidth: w });
    this.log("Paper width manually set to", w, "mm");
    return w;
  }

  /** Chhota built-in settings popup: paper size + cut mode. UI mein button se call karo. */
  openSettingsDialog() {
    const currentW = this.paperWidth;
    const w = prompt(
      "Paper width chuno:\n\n1 = 58mm (chhota roll)\n2 = 80mm (bada roll)\n\nAbhi: " + currentW + "mm",
      currentW <= 58 ? "1" : "2"
    );
    if (w === "1") this.setPaperWidth(58);
    else if (w === "2") this.setPaperWidth(80);

    const cutChoice = confirm(
      "Cut mode:\n\nOK = Haath se faado (skip auto-cut, kam waste)\nCancel = Printer khud cut kare"
    );
    this.setSettings({ skipCut: cutChoice, feedBeforeCut: cutChoice ? 1 : 2 });

    return { paperWidth: this.paperWidth, skipCut: this.skipCut };
  }

  setSettings(opts = {}) {
    if (opts.paperWidth != null) {
      this.paperWidth = Number(opts.paperWidth);
      this.charsPerLine = this.paperWidth <= 58 ? 32 : 48;
      localStorage.setItem("sm_printer_width", String(this.paperWidth));
    }
    if (opts.chunkSize != null) this.chunkSize = opts.chunkSize;
    if (opts.chunkDelay != null) this.chunkDelay = opts.chunkDelay;
    if (opts.feedBeforeCut != null) this.feedBeforeCut = opts.feedBeforeCut;
    if (opts.usePartialCut != null) this.usePartialCut = opts.usePartialCut;
    if (opts.skipCut != null) this.skipCut = opts.skipCut;
    if (opts.debug != null) this.debug = opts.debug;
  }

  _line() {
    return "-".repeat(Math.min(this.charsPerLine, 48));
  }

  /* ===================== ESC/POS ===================== */

  async init() {
    await this.write(new Uint8Array([0x1b, 0x40])); // ESC @
    this.charsPerLine = this.paperWidth <= 58 ? 32 : 48;
  }

  async printText(text, opts = {}) {
    const { align = "left", bold = false, double = false } = opts;
    if (align === "center") await this.write(new Uint8Array([0x1b, 0x61, 0x01]));
    else if (align === "right") await this.write(new Uint8Array([0x1b, 0x61, 0x02]));
    else await this.write(new Uint8Array([0x1b, 0x61, 0x00]));
    if (bold) await this.write(new Uint8Array([0x1b, 0x45, 0x01]));
    if (double) await this.write(new Uint8Array([0x1d, 0x21, 0x11]));
    await this.write(new TextEncoder().encode(String(text) + "\n"));
    await this.write(new Uint8Array([0x1d, 0x21, 0x00]));
    await this.write(new Uint8Array([0x1b, 0x45, 0x00]));
  }

  async feed(n = 1) {
    if (!n || n < 1) return;
    await this.write(new Uint8Array([0x1b, 0x64, Math.min(n, 255)]));
  }

  async cut() {
    // GS V 0 — full cut, minimal advance on many models
    await this.write(new Uint8Array([0x1d, 0x56, 0x00]));
  }

  async partialCut() {
    // GS V 1 — partial cut
    await this.write(new Uint8Array([0x1d, 0x56, 0x01]));
  }

  /**
   * End of receipt: chhota feed + optional cut.
   * PT-210 / Goojprt aksar cut pe bohot paper nikalte hain —
   * default: sirf 2 line feed, cut optional (skipCut / partial).
   */
  async doCut() {
    const lines = Math.max(0, Number(this.feedBeforeCut) || 0);
    if (lines > 0) await this.feed(lines);
    if (this.skipCut) return; // sirf feed, haath se faado — kam waste
    try {
      if (this.usePartialCut) await this.partialCut();
      else await this.cut();
    } catch (e) {
      this.log("Cut failed", e);
    }
  }

  async printSmall(text, opts = {}) {
    const { align = "center" } = opts;
    if (align === "center") await this.write(new Uint8Array([0x1b, 0x61, 0x01]));
    else await this.write(new Uint8Array([0x1b, 0x61, 0x00]));
    await this.write(new Uint8Array([0x1b, 0x4d, 0x01]));
    await this.write(new TextEncoder().encode(String(text) + "\n"));
    await this.write(new Uint8Array([0x1b, 0x4d, 0x00]));
  }

  /**
   * ESC/POS QR (most Goojprt / Xprinter / Rongta)
   * size: 3–8 (module size), default 4
   */
  async printQR(text, opts = {}) {
    const data = String(text || "");
    if (!data) return;
    const size = Math.min(8, Math.max(3, Number(opts.size) || 4));
    const enc = new TextEncoder().encode(data);
    const len = enc.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;

    await this.write(new Uint8Array([0x1b, 0x61, 0x01])); // center

    // Model 2
    await this.write(new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));
    // Module size
    await this.write(new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]));
    // Error correction M
    await this.write(new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]));
    // Store data
    const store = new Uint8Array(8 + enc.length);
    store.set([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30], 0);
    store.set(enc, 8);
    await this.write(store);
    // Print
    await this.write(new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]));
    await this.write(new Uint8Array([0x0a]));
  }

  async printLogo(base64, maxWidth = 144) {
    if (!base64) return;
    try {
      const src = base64.startsWith("data:") ? base64 : "data:image/jpeg;base64," + base64;
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
      });

      let paperDots = this.paperWidth <= 58 ? 384 : 576;
      paperDots = Math.floor(paperDots / 8) * 8;
      let logoW = Math.min(maxWidth, paperDots - 16);
      logoW = Math.floor(logoW / 8) * 8;
      if (logoW < 8) logoW = 8;
      let logoH = Math.round((img.height / img.width) * logoW);

      const canvas = document.createElement("canvas");
      canvas.width = paperDots;
      canvas.height = logoH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, paperDots, logoH);
      const left = Math.floor((paperDots - logoW) / 2);
      ctx.drawImage(img, left, 0, logoW, logoH);

      const imageData = ctx.getImageData(0, 0, paperDots, logoH);
      const pixels = imageData.data;
      const bytesPerRow = paperDots / 8;
      const raster = new Uint8Array(bytesPerRow * logoH);

      for (let y = 0; y < logoH; y++) {
        for (let x = 0; x < paperDots; x++) {
          const i = (y * paperDots + x) * 4;
          const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          if (gray < 140) raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }

      await this.write(new Uint8Array([0x1b, 0x61, 0x00]));
      const xL = bytesPerRow & 0xff;
      const xH = (bytesPerRow >> 8) & 0xff;
      const yL = logoH & 0xff;
      const yH = (logoH >> 8) & 0xff;
      await this.write(new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]));
      await this.write(raster);
      await this.write(new Uint8Array([0x0a]));
    } catch (e) {
      this.log("Logo print failed", e);
    }
  }

  _row(label, value) {
    const w = this.charsPerLine;
    const L = String(label);
    const V = String(value == null ? "—" : value);
    const gap = w - L.length - V.length;
    if (gap >= 1) return L + " ".repeat(gap) + V;
    return L + "\n" + V;
  }

  async printTest() {
    await this.init();
    await this.printText("=== PRINTER TEST ===", { align: "center", bold: true });
    await this.printText(this._line(), { align: "center" });
    await this.printText("Paper: " + this.paperWidth + "mm", { align: "center" });
    await this.printText(this.connectionType === "usb" ? "USB" : "Bluetooth", { align: "center" });
    await this.printText(new Date().toLocaleString(), { align: "center" });
    await this.printText(this._line(), { align: "center" });
    await this.printQR("SM-TEST-" + Date.now(), { size: 4 });
    await this.printSmall("QR + paper auto-detect OK", { align: "center" });
    await this.doCut();
  }
}

window.ThermalPrinter = ThermalPrinter;
// PT-210 / Goojprt defaults: 58mm, kam feed, partial cut
window.shopPrinter = new ThermalPrinter({
  debug: false,
  paperWidth: Number(localStorage.getItem("sm_printer_width")) || 58,
  chunkSize: 48,
  chunkDelay: 40,
  feedBeforeCut: 1,       // haath se faadne ke liye sirf 1 line feed
  usePartialCut: true,
  skipCut: true           // auto-cut band — cutter ka extra feed/waste khatam
});
