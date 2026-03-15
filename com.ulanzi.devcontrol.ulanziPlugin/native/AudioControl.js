/**
 * AudioControl.js
 *
 * Systemweite Audiogerätesteuerung für Windows 10/11.
 *
 * Nutzt PersistentShell.js: Ein einziger powershell.exe-Prozess bleibt
 * dauerhaft offen. C# wird einmalig beim Start via Add-Type kompiliert.
 * Folgeoperationen: <50ms statt 1-3s (kein Prozess-Spawn-Overhead).
 *
 * APIs (keine Admin-Rechte erforderlich):
 *   IPolicyConfig          – Standard-Audiogerät wechseln
 *   IAudioEndpointVolume   – Mute-Status lesen/schreiben
 *   IMMDeviceEnumerator    – Geräte auflisten
 */

'use strict';

const path  = require('path');
const shell = require('./PersistentShell');

// Pfad zur gecachten DLL (neben bridge.js im native/-Ordner)
// Backslashes werden im INIT_SCRIPT via .replace() für PS-Strings escaped.
const DLL_PATH = path.join(__dirname, 'DevControlV2.dll');

// ═══════════════════════════════════════════════════════════════════════════════
//  C#-Quellcode (nur der reine C#-Code, kein PS-Wrapper)
//  Wird bei erstem Start kompiliert und als DevControl.dll gecacht.
//  Folgestarts: Add-Type -Path (< 100ms statt 5-30s Kompilierung).
// ═══════════════════════════════════════════════════════════════════════════════

const CSHARP_SOURCE = `using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DevControl {

    public enum EDataFlow  { eRender = 0, eCapture = 1, eAll = 2 }
    public enum ERole      { eConsole = 0, eMultimedia = 1, eCommunications = 2 }
    public enum DeviceState { Active = 1, Disabled = 2, NotPresent = 4, Unplugged = 8 }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection ppDevices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    [ComImport] class MMDeviceEnumeratorClass {}

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection {
        int GetCount(out int pcDevices);
        int Item(int nDevice, out IMMDevice ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams,
                     [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
    }

    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        int GetCount(out int cProps);
        int GetAt(int iProp, out PropertyKey pkey);
        int GetValue(ref PropertyKey key, out PropVariant pv);
        int SetValue(ref PropertyKey key, ref PropVariant propvar);
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey {
        public Guid fmtid;
        public int  pid;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant {
        [FieldOffset(0)] public short  vt;
        [FieldOffset(8)] public IntPtr p;
        [FieldOffset(8)] public int    lVal;
        [FieldOffset(8)] public long   hVal;
        [FieldOffset(8)] public float  fltVal;
        [FieldOffset(8)] public double dblVal;
    }

    // IPolicyConfig: undokumentiert, aber seit Vista stabil – kein Admin nötig
    [Guid("f8679f50-850a-41cf-9c72-430f290290c8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig {
        int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string dev, IntPtr fmt);
        int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string dev, bool bDef, IntPtr fmt);
        int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string dev);
        int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string dev, IntPtr ep, IntPtr mix);
        int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string dev, bool bDef, IntPtr pDef, IntPtr pMin);
        int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string dev, IntPtr p);
        int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string dev, IntPtr mode);
        int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string dev, IntPtr mode);
        int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string dev, bool bFx, ref PropertyKey key, IntPtr pv);
        int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string dev, bool bFx, ref PropertyKey key, IntPtr pv);
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string dev, ERole role);
        int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string dev, bool bVisible);
    }

    [Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    [ComImport] class CPolicyConfigClient {}

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out int pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid ctx);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid ctx);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid ctx);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid ctx);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid ctx);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
        int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
        int VolumeStepUp(ref Guid ctx);
        int VolumeStepDown(ref Guid ctx);
        int QueryHardwareSupport(out uint pdwHardwareSupportMask);
        int GetVolumeRange(out float pflMin, out float pflMax, out float pflIncrement);
    }

    public static class AudioManager {

        private static IMMDeviceEnumerator CreateEnumerator() {
            var type = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
            return (IMMDeviceEnumerator)Activator.CreateInstance(type);
        }

        public static List<AudioDeviceInfo> GetDevices(EDataFlow flow) {
            var enumerator = CreateEnumerator();
            try {
                IMMDeviceCollection collection;
                enumerator.EnumAudioEndpoints(flow, (int)DeviceState.Active, out collection);

                string defaultId = null;
                try {
                    IMMDevice def;
                    enumerator.GetDefaultAudioEndpoint(flow, ERole.eMultimedia, out def);
                    def.GetId(out defaultId);
                    Marshal.ReleaseComObject(def);
                } catch {}

                int count;
                collection.GetCount(out count);
                var result = new List<AudioDeviceInfo>();

                for (int i = 0; i < count; i++) {
                    IMMDevice device;
                    collection.Item(i, out device);
                    string id;
                    device.GetId(out id);

                    // PKEY_Device_FriendlyName: {A45C254E-DF1C-4EFD-8020-67D146A850E0}, pid=14
                    string name = id;
                    try {
                        IPropertyStore store;
                        device.OpenPropertyStore(0, out store); // STGM_READ = 0
                        var key = new PropertyKey {
                            fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
                            pid   = 14
                        };
                        PropVariant pv;
                        store.GetValue(ref key, out pv);
                        if (pv.vt == 31 && pv.p != IntPtr.Zero) // VT_LPWSTR = 31
                            name = Marshal.PtrToStringUni(pv.p);
                        Marshal.ReleaseComObject(store);
                    } catch {}

                    result.Add(new AudioDeviceInfo { Id = id, Name = name, IsDefault = id == defaultId });
                    Marshal.ReleaseComObject(device);
                }

                Marshal.ReleaseComObject(collection);
                return result;
            } finally {
                Marshal.ReleaseComObject(enumerator);
            }
        }

        public static void SetDefaultDevice(string deviceId) {
            var policy = (IPolicyConfig)new CPolicyConfigClient();
            try {
                policy.SetDefaultEndpoint(deviceId, ERole.eConsole);
                policy.SetDefaultEndpoint(deviceId, ERole.eMultimedia);
                policy.SetDefaultEndpoint(deviceId, ERole.eCommunications);
            } finally {
                Marshal.ReleaseComObject(policy);
            }
        }

        private static IAudioEndpointVolume GetVolumeInterface(string deviceId, EDataFlow flow) {
            var enumerator = CreateEnumerator();
            try {
                IMMDevice device;
                if (string.IsNullOrEmpty(deviceId)) {
                    enumerator.GetDefaultAudioEndpoint(flow, ERole.eCommunications, out device);
                } else {
                    enumerator.GetDevice(deviceId, out device);
                }
                var volGuid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
                object volObj;
                device.Activate(ref volGuid, 1, IntPtr.Zero, out volObj);
                Marshal.ReleaseComObject(device);
                return (IAudioEndpointVolume)volObj;
            } finally {
                Marshal.ReleaseComObject(enumerator);
            }
        }

        public static bool GetMute(string deviceId) {
            var vol = GetVolumeInterface(deviceId, EDataFlow.eCapture);
            try {
                bool muted;
                vol.GetMute(out muted);
                return muted;
            } finally {
                Marshal.ReleaseComObject(vol);
            }
        }

        public static bool SetMute(string deviceId, bool muted) {
            var vol = GetVolumeInterface(deviceId, EDataFlow.eCapture);
            try {
                var guid = Guid.Empty;
                vol.SetMute(muted, ref guid);
                return muted;
            } finally {
                Marshal.ReleaseComObject(vol);
            }
        }

        public static bool GetOutputMute(string deviceId) {
            var vol = GetVolumeInterface(deviceId, EDataFlow.eRender);
            try {
                bool muted;
                vol.GetMute(out muted);
                return muted;
            } finally {
                Marshal.ReleaseComObject(vol);
            }
        }

        public static bool SetOutputMute(string deviceId, bool muted) {
            var vol = GetVolumeInterface(deviceId, EDataFlow.eRender);
            try {
                var guid = Guid.Empty;
                vol.SetMute(muted, ref guid);
                return muted;
            } finally {
                Marshal.ReleaseComObject(vol);
            }
        }
    }

    public class AudioDeviceInfo {
        public string Id        { get; set; }
        public string Name      { get; set; }
        public bool   IsDefault { get; set; }
    }
}
`;

// ── Shell-Initialisierung mit DLL-Cache ───────────────────────────────────────
// Strategie:
//   1. Wenn DevControl.dll existiert → Add-Type -Path   (< 100ms, jeder Start)
//   2. Wenn nicht → Add-Type -OutputAssembly            (einmalig 5-30s, speichert DLL)
//   3. Falls DLL-Speichern fehlschlägt → in-memory      (Fallback)
// runInit() umgeht das Init-Gate – ist selbst der Initialisierer.

// PS-Skript für DLL-Laden (Pfad als PS-String escaped)
// In PS-Einfachanführungszeichen: Backslashes sind literal, nur ' wird zu ''
const INIT_SCRIPT = `
$dll = '${DLL_PATH.replace(/'/g, "''")}'
if (Test-Path $dll) {
    Add-Type -Path $dll -ErrorAction SilentlyContinue
    Write-Output 'dll'
} else {
    $src = @'
${CSHARP_SOURCE}
'@
    try {
        Add-Type -Language CSharp -TypeDefinition $src -OutputAssembly $dll -ErrorAction SilentlyContinue
        Add-Type -Path $dll -ErrorAction SilentlyContinue
        Write-Output 'compiled+saved'
    } catch {
        Add-Type -Language CSharp -TypeDefinition $src -ErrorAction SilentlyContinue
        Write-Output 'compiled-only'
    }
}
`;

shell.setInitializer(async () => {
  try {
    const result = await shell.runInit(INIT_SCRIPT, 120000);
    console.log(`[Audio] C# bereit (${result || 'ok'}).`);
  } catch (err) {
    console.error('[Audio] C#-Initialisierung fehlgeschlagen:', err.message);
  }
});

// ── Hilfsfunktion ─────────────────────────────────────────────────────────────

/** Escaped einen String sicher für PowerShell-Einfachanführungszeichen. */
function ps(str) {
  return String(str).replace(/'/g, "''");
}

// ── API-Methoden ──────────────────────────────────────────────────────────────

/**
 * Gibt alle aktiven Audioausgabegeräte zurück.
 * @returns {Promise<Array<{id, name, isDefault}>>}
 */
async function getOutputDevices() {
  return shell.runJson(`
$d = [DevControl.AudioManager]::GetDevices([DevControl.EDataFlow]::eRender)
@($d | ForEach-Object { @{ id=$_.Id; name=$_.Name; isDefault=$_.IsDefault } }) | ConvertTo-Json -Compress
`);
}

/**
 * Gibt alle aktiven Audioeingabegeräte (Mikrofone) zurück.
 * @returns {Promise<Array<{id, name, isDefault}>>}
 */
async function getInputDevices() {
  return shell.runJson(`
$d = [DevControl.AudioManager]::GetDevices([DevControl.EDataFlow]::eCapture)
@($d | ForEach-Object { @{ id=$_.Id; name=$_.Name; isDefault=$_.IsDefault } }) | ConvertTo-Json -Compress
`);
}

/**
 * Setzt das Standard-Ausgabegerät systemweit (alle 3 Rollen).
 * Nutzt IPolicyConfig – KEINE Admin-Rechte erforderlich.
 * @param {string} deviceId - MMDevice-ID
 * @returns {Promise<{success: boolean}>}
 */
async function setDefaultOutput(deviceId) {
  await shell.run(`[DevControl.AudioManager]::SetDefaultDevice('${ps(deviceId)}')`);
  return { success: true };
}

/**
 * Setzt das Standard-Eingabegerät systemweit.
 * IPolicyConfig funktioniert für Input und Output gleichermaßen.
 * @param {string} deviceId - MMDevice-ID
 * @returns {Promise<{success: boolean}>}
 */
async function setDefaultInput(deviceId) {
  return setDefaultOutput(deviceId);
}

/**
 * Gibt den aktuellen Mute-Status zurück.
 * @param {string|null} deviceId - null = Standard-Mikrofon (Communications-Rolle)
 * @returns {Promise<{muted: boolean}>}
 */
async function getMicrophoneMute(deviceId = null) {
  const arg = deviceId ? `'${ps(deviceId)}'` : '$null';
  return shell.runJson(`
$m = [DevControl.AudioManager]::GetMute(${arg})
'{"muted":' + $m.ToString().ToLower() + '}' | Write-Output
`);
}

/**
 * Setzt den Mute-Status des Mikrofons.
 * @param {boolean} muted
 * @param {string|null} deviceId
 * @returns {Promise<{muted: boolean}>}
 */
async function setMicrophoneMute(muted, deviceId = null) {
  const arg   = deviceId ? `'${ps(deviceId)}'` : '$null';
  const psVal = muted ? '$true' : '$false';
  await shell.run(`[DevControl.AudioManager]::SetMute(${arg}, ${psVal}) | Out-Null`);
  return { muted };
}

/**
 * Liest Status, invertiert ihn und setzt ihn – alles in einer Shell-Transaktion.
 * Kein TOCTOU-Problem, da Get + Set atomar im selben PS-Befehl ablaufen.
 * @param {string|null} deviceId
 * @returns {Promise<{muted: boolean}>}
 */
async function toggleMicrophoneMute(deviceId = null) {
  const arg = deviceId ? `'${ps(deviceId)}'` : '$null';
  return shell.runJson(`
$cur = [DevControl.AudioManager]::GetMute(${arg})
$new = -not $cur
[DevControl.AudioManager]::SetMute(${arg}, $new) | Out-Null
'{"muted":' + $new.ToString().ToLower() + '}' | Write-Output
`);
}

async function getOutputMute(deviceId = null) {
  const arg = deviceId ? `'${ps(deviceId)}'` : '$null';
  return shell.runJson(`
$m = [DevControl.AudioManager]::GetOutputMute(${arg})
'{"muted":' + $m.ToString().ToLower() + '}' | Write-Output
`);
}

async function setOutputMute(muted, deviceId = null) {
  const arg   = deviceId ? `'${ps(deviceId)}'` : '$null';
  const psVal = muted ? '$true' : '$false';
  await shell.run(`[DevControl.AudioManager]::SetOutputMute(${arg}, ${psVal}) | Out-Null`);
  return { muted };
}

async function toggleOutputMute(deviceId = null) {
  const arg = deviceId ? `'${ps(deviceId)}'` : '$null';
  return shell.runJson(`
$cur = [DevControl.AudioManager]::GetOutputMute(${arg})
$new = -not $cur
[DevControl.AudioManager]::SetOutputMute(${arg}, $new) | Out-Null
'{"muted":' + $new.ToString().ToLower() + '}' | Write-Output
`);
}

module.exports = {
  getOutputDevices,
  getInputDevices,
  setDefaultOutput,
  setDefaultInput,
  getMicrophoneMute,
  setMicrophoneMute,
  toggleMicrophoneMute,
  getOutputMute,
  setOutputMute,
  toggleOutputMute
};
