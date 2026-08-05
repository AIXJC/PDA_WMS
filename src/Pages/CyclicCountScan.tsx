import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Check, AlertTriangle, XCircle, ScanLine } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion, AnimatePresence } from 'framer-motion';
import * as mobileFeatures from '../utils/mobileFeatures';

let BrowserMultiFormatReader: any = null;
try {
  const zxing = require('@zxing/browser');
  BrowserMultiFormatReader = zxing.BrowserMultiFormatReader;
} catch (error) {
  console.warn('ZXing not available, scanner fallback disabled', error);
}

interface CycleDetail {
  CycleCountID: number;
  ERPCycleCountID: string | null;
  StatusID: number;
  StatusCode: string;
  StatusDescription: string;
  PartNumber: string | null;
  PartName: string | null;
  LocationCode: string | null;
  RackName: string | null;
  RackColumn: number | null;
  RackCell: number | null;
  SystemQuantity: number | null;
  CountedQuantity: number | null;
}

interface ScanEntry {
  id: string;
  batch: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  countedQuantity?: number;
  timestamp: number;
}

const RESCAN_COOLDOWN_MS = 4000;

export const CyclicCountScan: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [loadingCycle, setLoadingCycle] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<any>(null);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const processingRef = useRef(false);

  const loadCycle = useCallback(async () => {
    setLoadingCycle(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/cyclic-count/${id}`);
      if (!res.ok) throw new Error('No se pudo cargar el conteo cíclico');
      const data = await res.json();
      setCycle(data.cycle ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error cargando el conteo');
    } finally {
      setLoadingCycle(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCycle();
  }, [loadCycle]);

  const handleDetected = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || processingRef.current) return;

    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.code === trimmed && (now - lastScanRef.current.time) < RESCAN_COOLDOWN_MS) {
      return;
    }
    lastScanRef.current = { code: trimmed, time: now };

    processingRef.current = true;
    setIsProcessing(true);

    try {
      const res = await fetch(`/api/cyclic-count/${id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: trimmed }),
      });
      const data = await res.json().catch(() => ({}));

      const entry: ScanEntry = res.ok
        ? {
            id: `${trimmed}-${now}`,
            batch: trimmed,
            status: 'success',
            message: data.message || 'Conteo registrado',
            countedQuantity: data.countedQuantity,
            timestamp: now,
          }
        : {
            id: `${trimmed}-${now}`,
            batch: trimmed,
            status: data.warning ? 'warning' : 'error',
            message: data.message || 'Error al registrar el conteo',
            timestamp: now,
          };

      setScans((prev) => [entry, ...prev]);

      if (mobileFeatures.isInWebView()) {
        mobileFeatures.callNative('hapticFeedback', { type: entry.status === 'success' ? 'medium' : 'heavy' });
        mobileFeatures.callNative('playSound', { name: entry.status === 'success' ? 'scan_success' : 'scan_error' });
      } else {
        mobileFeatures.vibrate(entry.status === 'success' ? 80 : [80, 60, 80]);
      }
    } catch (err) {
      setScans((prev) => [{
        id: `${trimmed}-${now}`,
        batch: trimmed,
        status: 'error',
        message: err instanceof Error ? err.message : 'Error de red al registrar el conteo',
        timestamp: now,
      }, ...prev]);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [id]);

  useEffect(() => {
    let rafId: number | null = null;
    let cancelled = false;

    const startCameraAndDecode = async () => {
      try {
        const stream = await mobileFeatures.requestCamera('environment');
        if (cancelled) {
          mobileFeatures.stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const hasNative = (window as any).BarcodeDetector;
        if (hasNative) {
          const formats = ['code_128', 'ean_13', 'ean_8', 'qr_code', 'code_39', 'code_93'];
          const detector = new (window as any).BarcodeDetector({ formats });

          const detectLoop = async () => {
            try {
              if (!videoRef.current || videoRef.current.readyState < 2) {
                rafId = requestAnimationFrame(detectLoop);
                return;
              }
              const barcodes = await detector.detect(videoRef.current as HTMLVideoElement);
              if (barcodes && barcodes.length) {
                const raw = barcodes[0].rawValue || barcodes[0].raw_text || barcodes[0].displayValue;
                if (raw) await handleDetected(raw);
              }
            } catch (err) {
              console.warn('BarcodeDetector error', err);
            }
            rafId = requestAnimationFrame(detectLoop);
          };

          detectLoop();
          return;
        }

        try {
          if (BrowserMultiFormatReader) {
            const codeReader = new BrowserMultiFormatReader();
            readerRef.current = codeReader;
            if (videoRef.current) {
              codeReader.decodeFromVideoElement(videoRef.current, (result: any) => {
                if (result && result.getText) {
                  void handleDetected(result.getText());
                }
              });
            }
          } else {
            setCameraError('El escaneo por cámara no está disponible en este dispositivo.');
          }
        } catch (err) {
          console.warn('ZXing fallback failed', err);
          setCameraError('El escaneo por cámara no está disponible en este dispositivo.');
        }
      } catch (error) {
        console.error('Camera start failed', error);
        setCameraError('No se pudo acceder a la cámara/escáner del dispositivo.');
      }
    };

    void startCameraAndDecode();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (readerRef.current && readerRef.current.reset) {
        try { readerRef.current.reset(); } catch { /* noop */ }
      }
      if (streamRef.current) {
        mobileFeatures.stopStream(streamRef.current);
        streamRef.current = null;
      }
      if (videoRef.current) {
        try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch { /* noop */ }
      }
    };
  }, [handleDetected]);

  const locationLabel = cycle
    ? (cycle.RackName ? `${cycle.RackName}-${Number(cycle.RackColumn || 0)}-${Number(cycle.RackCell || 0)}` : cycle.LocationCode || '')
    : '';

  return (
    <Layout title={cycle ? `Conteo ${cycle.ERPCycleCountID || cycle.CycleCountID}` : 'Conteo Cíclico'} showNav={false}>
      <div className="space-y-4">
        <button
          onClick={() => navigate('/inventory/cyclic')}
          className="flex items-center gap-2 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-widest"
        >
          <ArrowLeft size={16} />
          <span>Volver a conteos</span>
        </button>

        {loadingCycle ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando conteo...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {loadError}
          </div>
        ) : cycle ? (
          <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-xl space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">ID ERP</p>
                <h2 className="text-xl font-black">{cycle.ERPCycleCountID || `Ciclo ${cycle.CycleCountID}`}</h2>
              </div>
              <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-white/10">
                {cycle.StatusDescription || cycle.StatusCode}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Parte</p>
                <p className="mt-1 font-bold">{cycle.PartName || cycle.PartNumber || '—'}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ubicación</p>
                <p className="mt-1 font-bold">{locationLabel || '—'}</p>
              </div>
            </div>
            <p className="text-xs text-slate-300">Escanea el lote (QR) de cada empaque para registrar el conteo físico.</p>
          </div>
        ) : null}

        <div className="relative rounded-[2rem] overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/50 pointer-events-none" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-56 h-56 border-2 border-white/30 rounded-[2rem]">
              <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-xl" />
              <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-xl" />
              <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-xl" />
              <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-xl" />
              <motion.div
                animate={{ top: ['10%', '90%', '10%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="absolute left-4 right-4 h-0.5 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)]"
              />
            </div>
          </div>
          {isProcessing && (
            <div className="absolute top-4 right-4 bg-blue-600 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <LoaderCircle size={12} className="animate-spin" />
              Registrando...
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center">
              <p className="text-white text-sm font-semibold">{cameraError}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-black text-slate-400 dark:text-slate-400 uppercase">Escaneos</h3>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400">{scans.length} registrados</span>
          </div>

          {scans.length === 0 ? (
            <div className="bg-white dark:bg-slate-800/95 rounded-[1.5rem] p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
              <ScanLine size={28} className="text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-300 font-medium">Escanea un lote para comenzar.</p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {scans.map((scan) => {
                const Icon = scan.status === 'success' ? Check : scan.status === 'warning' ? AlertTriangle : XCircle;
                const colors = scan.status === 'success'
                  ? 'border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : scan.status === 'warning'
                    ? 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-rose-200 dark:border-rose-700 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300';

                return (
                  <motion.div
                    key={scan.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={`rounded-2xl border p-3 flex items-start gap-3 mb-2 ${colors}`}
                  >
                    <Icon size={18} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black truncate">{scan.batch}</p>
                      <p className="text-xs font-semibold opacity-90">{scan.message}</p>
                      {scan.countedQuantity !== undefined && (
                        <p className="text-[10px] font-bold opacity-75 mt-0.5">Cantidad contada: {Number(scan.countedQuantity).toFixed(2)}</p>
                      )}
                    </div>
                    <span className="text-[9px] font-bold opacity-60 flex-shrink-0">
                      {new Date(scan.timestamp).toLocaleTimeString()}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>
    </Layout>
  );
};
