import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../utils/apiBase';
import {
  Scan,
  X, 
  Zap, 
  History, 
  Layers, 
  Check, 
  AlertCircle,
  Info,
  ChevronRight,
  Volume2,
  Vibrate
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import useInventoryStore, { Product } from '../store/useInventoryStore';
import { motion, AnimatePresence } from 'framer-motion';
import * as mobileFeatures from '../utils/mobileFeatures';

let BrowserMultiFormatReader: any = null;
try {
  const zxing = require('@zxing/browser');
  BrowserMultiFormatReader = zxing.BrowserMultiFormatReader;
} catch (error) {
  console.warn('ZXing not available, scanner fallback disabled', error);
}

export const Scanner: React.FC = () => {
  const { t } = useTranslation();
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<Product | null>(null);
  const [mode, setMode] = useState<'single' | 'continuous' | 'massive'>('single');
  const [flash, setFlash] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  
  const { products, addToHistory, scannedHistory } = useInventoryStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<any>(null);

  const handleScan = (sku: string) => {
    const product = products.find(p => p.sku === sku);
    
    if (product) {
      setLastScanned(product);
      addToHistory(product);
      setScanCount(prev => prev + 1);
      
      // Feedback
      if (mobileFeatures.isInWebView()) {
        mobileFeatures.callNative('hapticFeedback', { type: 'medium' });
        mobileFeatures.callNative('playSound', { name: 'scan_success' });
      }

      if (mode === 'single') {
        setIsScanning(false);
      }
    } else {
      // Error feedback
      if (mobileFeatures.isInWebView()) {
        mobileFeatures.callNative('hapticFeedback', { type: 'error' });
      }
    }
  };

  // Mock auto-scan for demo
  // Start camera and barcode decoding when scanner is active
  useEffect(() => {
    let rafId: number | null = null;

    const startCameraAndDecode = async () => {
      try {
        const stream = await mobileFeatures.requestCamera('environment');
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Prefer native BarcodeDetector when available
        const hasNative = (window as any).BarcodeDetector;
        if (hasNative) {
          const formats = ['code_128','ean_13','ean_8','qr_code','code_39','code_93'];
          const detector = new (window as any).BarcodeDetector({ formats });

          const detectLoop = async () => {
            try {
              if (!videoRef.current || videoRef.current.readyState < 2) {
                rafId = requestAnimationFrame(detectLoop);
                return;
              }
              const barcodes = await detector.detect(videoRef.current as HTMLVideoElement);
              if (barcodes && barcodes.length) {
                const code = barcodes[0].rawValue || barcodes[0].raw_text || barcodes[0].displayValue;
                if (code) await handleDetected(code);
              }
            } catch (err) {
              console.warn('BarcodeDetector error', err);
            }
            rafId = requestAnimationFrame(detectLoop);
          };

          detectLoop();
          return;
        }

        // Fallback to @zxing/browser
        try {
          if (BrowserMultiFormatReader) {
            const codeReader = new BrowserMultiFormatReader();
            readerRef.current = codeReader;
            if (videoRef.current) {
              codeReader.decodeFromVideoElement(videoRef.current, (result: any, err: any) => {
                if (result && result.getText) {
                  handleDetected(result.getText());
                }
              });
            }
          }
        } catch (err) {
          console.warn('ZXing fallback failed', err);
        }
      } catch (error) {
        console.error('Camera start failed', error);
      }
    };

    const stopAll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (readerRef.current && readerRef.current.reset) {
        try { readerRef.current.reset(); } catch {}
      }
      if (streamRef.current) {
        mobileFeatures.stopStream(streamRef.current);
        streamRef.current = null;
      }
      if (videoRef.current) {
        try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch {}
      }
    };

    if (isScanning) startCameraAndDecode();
    else stopAll();

    return () => stopAll();
  }, [isScanning, mode]);

  const handleDetected = async (code: string) => {
    // call backend scanner endpoint to get product info
    try {
      const resp = await fetch(`${API_BASE_URL}/api/scanner/${encodeURIComponent(code)}`);
      const data = await resp.json();
      if (data && data.found) {
        // prefer inventory first
        const item = (data.inventory && data.inventory[0]) || (data.packs && data.packs[0]);
        if (item) {
          const product: Product = {
            sku: item.PartNumber || item.PackBarcode || code,
            name: item.PartName || item.PackDescription || code,
            description: item.PartName || '',
            image: '',
            stock: item.Quantity || item.Quantity || 0,
            location: item.LocationName || item.sourceLocationName || '',
          } as Product;

          setLastScanned(product);
          addToHistory(product);
          setScanCount((s) => s + 1);

          if (mobileFeatures.isInWebView()) {
            mobileFeatures.callNative('hapticFeedback', { type: 'medium' });
            mobileFeatures.callNative('playSound', { name: 'scan_success' });
          }

          if (mode === 'single') setIsScanning(false);
        }
      }
    } catch (err) {
      console.error('Scanner lookup failed', err);
    }
  };

  if (!isScanning && !lastScanned) {
    return (
      <Layout title={t('scanner.title')} showNav={true}>
        <div className="flex h-full min-h-[60vh] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Scan size={28} />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400 dark:text-slate-300">SmartGlasses</p>
            <h2 className="mt-3 text-xl font-black text-slate-900 dark:text-slate-100">Apartado reservado para SmartGlasses</h2>
            <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Próximamente V-2.0</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('scanner.title')} showNav={!isScanning}>
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        {/* Scanner Viewport */}
        <div className="relative flex-1 flex items-center justify-center overflow-hidden">
          {/* Camera Feed */}
          <div className="absolute inset-0 bg-slate-900 flex items-center justify-center">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />
          </div>

          {/* Scanning Frame */}
          <div className="relative w-64 h-64 border-2 border-white/30 rounded-[2rem]">
            <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-xl" />
            <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-xl" />
            <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-xl" />
            <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-xl" />
            
            {/* Laser Line */}
            <motion.div 
              animate={{ top: ['10%', '90%', '10%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="absolute left-4 right-4 h-0.5 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] z-10"
            />
          </div>

          {/* Top Controls */}
          <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start">
            <button 
              onClick={() => setIsScanning(false)}
              className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center text-white active:scale-90 transition-all"
            >
              <X size={24} />
            </button>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setFlash(!flash)}
                className={`w-12 h-12 backdrop-blur-md rounded-2xl flex items-center justify-center transition-all ${flash ? 'bg-amber-500 text-white' : 'bg-white/10 text-white'}`}
              >
                <Zap size={24} fill={flash ? 'currentColor' : 'none'} />
              </button>
              <button className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center text-white">
                <Volume2 size={24} />
              </button>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="absolute bottom-32 left-6 right-6 flex justify-center gap-2">
            {[
              { id: 'single', label: t('scanner.modeSingle'), icon: Scan },
              { id: 'continuous', label: t('scanner.modeContinuous'), icon: RefreshCw },
              { id: 'massive', label: t('scanner.modeMassive'), icon: Layers },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id as any)}
                className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  mode === m.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' : 'bg-white/10 text-white backdrop-blur-md'
                }`}
              >
                <m.icon size={16} />
                      <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Result Panel */}
        <AnimatePresence>
          {lastScanned && (
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white rounded-t-[3rem] p-8 shadow-2xl z-50"
            >
              <div className="flex items-start gap-6 mb-6">
                <div className="w-24 h-24 bg-slate-100 rounded-3xl overflow-hidden flex-shrink-0 border border-slate-100">
                  <img src={lastScanned.image} alt={lastScanned.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-md uppercase tracking-wider mb-2 inline-block">
                      SKU: {lastScanned.sku}
                    </span>
                      <div className="flex items-center gap-1 text-emerald-600 font-black text-xs">
                        <Check size={14} />
                        <span>{t('scanner.validated')}</span>
                      </div>
                  </div>
                  <h3 className="text-xl font-black text-slate-900 leading-tight mb-1">{lastScanned.name}</h3>
                  <p className="text-xs text-slate-500 font-medium line-clamp-2">{lastScanned.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{t('scanner.currentStock')}</p>
                    <p className="text-xl font-black text-slate-900">{lastScanned.stock} <span className="text-xs font-bold text-slate-500">{t('common.units')}</span></p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{t('scanner.location')}</p>
                    <p className="text-xl font-black text-slate-900">{lastScanned.location}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setLastScanned(null)}
                  className="flex-1 bg-slate-100 text-slate-600 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  {t('scanner.close')}
                </button>
                <button 
                  className="flex-1 bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <span>{t('scanner.viewDetails')}</span>
                  <ChevronRight size={18} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Massive Scan Counter */}
        {mode === 'massive' && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-8 py-4 rounded-full font-black text-lg shadow-2xl flex items-center gap-4">
            <Layers size={24} />
            <span>{scanCount} {t('scanner.scannedCount')}</span>
            <button 
              onClick={() => {
                setScanCount(0);
                setIsScanning(false);
              }}
              className="bg-white text-blue-600 px-4 py-1 rounded-full text-xs"
            >
              {t('scanner.finish')}
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
};

const RefreshCw = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
