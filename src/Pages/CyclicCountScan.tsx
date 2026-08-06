import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Check, AlertTriangle, XCircle, ScanLine } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion, AnimatePresence } from 'framer-motion';
import * as mobileFeatures from '../utils/mobileFeatures';

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
  const [scanInput, setScanInput] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);
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
      setScanInput('');
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [id]);

  const handleSubmitScan = useCallback(() => {
    void handleDetected(scanInput);
  }, [handleDetected, scanInput]);

  const handleInputBlur = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

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

        <div className="rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/95 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">
            <ScanLine size={16} />
            <span>Lector de código de barras</span>
          </div>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-400">
            Usa el lector físico del PDA para escanear el lote, o escríbelo manualmente.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoFocus
              value={scanInput}
              placeholder="Escanea o escribe el lote"
              onChange={(e) => setScanInput(e.target.value)}
              onBlur={handleInputBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmitScan();
                }
              }}
              className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-3 px-3 focus:border-blue-500 outline-none transition-all text-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={handleSubmitScan}
              disabled={!scanInput.trim() || isProcessing}
              className="rounded-2xl bg-blue-600 text-white px-4 py-3 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 active:scale-95 transition-all"
            >
              Registrar
            </button>
          </div>
          {isProcessing && (
            <div className="mt-3 inline-flex items-center gap-1.5 bg-blue-600 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-full">
              <LoaderCircle size={12} className="animate-spin" />
              Registrando...
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
