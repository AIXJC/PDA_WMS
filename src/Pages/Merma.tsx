import React, { useEffect, useState } from 'react';
import {
  Trash2,
  Camera,
  Scan,
  Check,
  Image as ImageIcon,
  X,
  LoaderCircle,
} from 'lucide-react';

interface LocationOption {
  LocationID: number;
  LocationName: string;
  RackName?: string;
}
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import { notifyAppRefresh, useAppRefresh } from '../utils/realtime';

export const Merma: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [step, setStep] = useState<'scan' | 'details' | 'success'>('scan');
  const [scannedProduct, setScannedProduct] = useState<any>(null);
  const [scanCode, setScanCode] = useState('');
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [recentScrap, setRecentScrap] = useState<any[]>([]);
  const [recentError, setRecentError] = useState('');
  const [selectedRecentScrap, setSelectedRecentScrap] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [sourceLocations, setSourceLocations] = useState<LocationOption[]>([]);
  const [destinationLocations, setDestinationLocations] = useState<LocationOption[]>([]);
  const [destinationOptionsBySource, setDestinationOptionsBySource] = useState<Record<string, LocationOption[]>>({});
  const [sourceLocationId, setSourceLocationId] = useState<number | ''>('');
  const [destinationLocationId, setDestinationLocationId] = useState<number | ''>('');

  const loadRecentScrap = async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoadingRecent(true);
      }
      if (showLoading) {
        setRecentError('');
      }
      const response = await fetch('/api/scrap?limit=4');
      if (!response.ok) throw new Error('No se pudieron cargar los registros recientes.');
      const data = await response.json();
      setRecentScrap(Array.isArray(data.scrap) ? data.scrap : []);
    } catch (err) {
      if (showLoading) {
        setRecentError(err instanceof Error ? err.message : 'No se pudieron cargar los registros recientes.');
        setRecentScrap([]);
      }
    } finally {
      if (showLoading) {
        setIsLoadingRecent(false);
      }
    }
  };

  useEffect(() => {
    void loadRecentScrap();
  }, []);

  useAppRefresh(() => {
    void loadRecentScrap(false);
  }, 10000);

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const response = await fetch('/api/scrap/location-options');
        if (!response.ok) return;
        const data = await response.json();
        setSourceLocations(Array.isArray(data.sourceLocations) ? data.sourceLocations : []);
        setDestinationLocations(Array.isArray(data.destinationLocations) ? data.destinationLocations : []);
        setDestinationOptionsBySource(
          data.destinationOptionsBySource && typeof data.destinationOptionsBySource === 'object'
            ? Object.entries(data.destinationOptionsBySource).reduce((acc, [key, value]) => {
                acc[key] = Array.isArray(value) ? value : [];
                return acc;
              }, {} as Record<string, LocationOption[]>)
            : {}
        );
      } catch {
        setSourceLocations([]);
        setDestinationLocations([]);
        setDestinationOptionsBySource({});
      }
    };

    loadLocations();
  }, []);

  useEffect(() => {
    if (scannedProduct?.locationId != null) {
      setSourceLocationId(scannedProduct.locationId);
      setDestinationLocationId('');
    }
  }, [scannedProduct]);

  const selectedSourceLocationName = sourceLocations.find((location) => location.LocationID === sourceLocationId)?.LocationName || '';
  const destinationOptionsForSelectedSource = selectedSourceLocationName
    ? (destinationOptionsBySource[selectedSourceLocationName] || [])
    : destinationLocations;
  const pendingFollowUpScrap = recentScrap.filter((item) => String(item.Comments || '').includes('SCRAP_PENDIENTE'));

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code) {
      setError('Ingresa un código o parte número para localizar el producto.');
      return;
    }

    try {
      setIsScanning(true);
      setError('');
      const response = await fetch(`/api/scanner/${encodeURIComponent(code)}`);
      if (!response.ok) throw new Error('No se pudo localizar el producto.');
      const data = await response.json();

      const inventoryItem = Array.isArray(data.inventory) && data.inventory.length > 0 ? data.inventory[0] : null;
      const packItem = Array.isArray(data.packs) && data.packs.length > 0 ? data.packs[0] : null;

      if (!inventoryItem && !packItem) {
        throw new Error('No se encontró el producto en inventario.');
      }

      setScannedProduct({
        sku: inventoryItem?.PartNumber || packItem?.PartNumber || code,
        name: inventoryItem?.PartName || packItem?.PartName || code,
        stock: inventoryItem?.Quantity ?? packItem?.Quantity ?? 0,
        unitType: inventoryItem?.UnitType || '',
        locationId: inventoryItem?.LocationID ?? packItem?.SourceLocationID ?? null,
        locationName: inventoryItem?.LocationName || packItem?.sourceLocationName || '',
      });
      setStep('details');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo localizar el producto.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddPhoto = () => {
    const mockPhoto = 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=400&h=400&fit=crop';
    setPhotos([...photos, mockPhoto]);
  };

  const handleSubmit = async () => {
    if (!scannedProduct) return;
    if (!reason) {
      setError('Selecciona un motivo antes de enviar la merma.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const response = await fetch('/api/scrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber: scannedProduct.sku,
          quantity,
          locationId: scannedProduct.locationId,
          sourceLocationId: sourceLocationId === '' ? null : Number(sourceLocationId),
          destinationLocationId: destinationLocationId === '' ? null : Number(destinationLocationId),
          comments: `${reason} | ${user?.name || 'Usuario'} | ${scannedProduct.locationName || 'Sin ubicación'}`,
          regUserId: user?.id ? Number(user.id) : null,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'No se pudo registrar la merma.');
      }

      await loadRecentScrap(false);
      notifyAppRefresh('action');
      setPhotos([]);
      setReason('');
      setQuantity(1);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la merma.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout title={t('merma.title')}>
      <AnimatePresence mode="wait">
        {step === 'scan' && (
          <motion.div 
            key="scan"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center py-12 space-y-8"
          >
            <div className="w-40 h-40 bg-rose-50 dark:bg-rose-500/10 rounded-[3rem] flex items-center justify-center text-rose-500 border-4 border-dashed border-rose-200 dark:border-rose-500/30">
              <Trash2 size={80} />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">{t('merma.reportDamage')}</h2>
            </div>
            <div className="w-full space-y-3">
              <input
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                placeholder="Escanea o escribe el código/part number"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-4 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="w-full bg-slate-900 text-white py-6 rounded-[2rem] font-black uppercase tracking-widest flex items-center justify-center gap-4 shadow-2xl shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-60"
              >
                {isScanning ? <LoaderCircle size={28} className="animate-spin" /> : <Scan size={28} />}
                <span>{t('merma.scanProductAction')}</span>
              </button>
            </div>

            <div className="w-full rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white/90 dark:bg-slate-800/80 p-4 shadow-sm space-y-4">
              {pendingFollowUpScrap.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-700/60 dark:bg-amber-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Scrap pendiente de seguimiento</h3>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">{pendingFollowUpScrap.length}</span>
                  </div>
                  <div className="space-y-2">
                    {pendingFollowUpScrap.map((item) => (
                      <div key={item.ScrapID} className="rounded-2xl bg-white/80 px-3 py-3 dark:bg-slate-800/80">
                        <p className="text-sm font-black text-slate-800 dark:text-slate-100">{item.PartName || item.PartNumber}</p>
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">{item.Comments || 'Sin comentarios'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t('merma.recentReports')}</h3>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{recentScrap.length}</span>
              </div>
              {isLoadingRecent ? (
                <p className="text-sm font-semibold text-slate-500">{t('merma.loadingRecent')}</p>
              ) : recentError ? (
                <p className="text-sm font-semibold text-rose-600">{recentError}</p>
              ) : recentScrap.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500">{t('merma.noReportsYet')}</p>
              ) : (
                <div className="space-y-2">
                  {recentScrap.map((item) => {
                    const isSelected = selectedRecentScrap?.ScrapID === item.ScrapID;
                    return (
                      <div key={item.ScrapID} className="rounded-2xl bg-slate-50 dark:bg-slate-700/70 px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedRecentScrap(isSelected ? null : item)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-black text-slate-800 dark:text-slate-100">{item.PartName || item.PartNumber}</p>
                              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">{item.Comments || t('merma.noComments')}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-rose-600">{item.Quantity} {t('common.units')}</p>
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{item.LocationName || 'Sin ubicación'}</p>
                            </div>
                          </div>
                        </button>
                        {isSelected && (
                          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-white/80 dark:bg-slate-800/80 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                            <p><span className="font-black uppercase tracking-[0.2em] text-slate-500">Part number:</span> {item.PartNumber}</p>
                            <p><span className="font-black uppercase tracking-[0.2em] text-slate-500">Usuario:</span> {item.RegUserFirstName || item.RegUserLastName ? `${item.RegUserFirstName || ''} ${item.RegUserLastName || ''}`.trim() : 'N/A'}</p>
                            <p><span className="font-black uppercase tracking-[0.2em] text-slate-500">Ubicación:</span> {item.LocationName || 'Sin ubicación'}</p>
                            <p><span className="font-black uppercase tracking-[0.2em] text-slate-500">Comentarios:</span> {item.Comments || t('merma.noComments')}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 'details' && (
          <motion.div 
            key="details"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            {/* Product Card */}
            <div className="bg-white dark:bg-slate-800/95 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4">
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700/70 rounded-2xl flex items-center justify-center text-slate-400 dark:text-slate-300">
                <ImageIcon size={32} />
              </div>
              <div>
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">{scannedProduct.sku}</span>
                <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">{scannedProduct.name}</h3>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase">{t('scanner.currentStock')}: {scannedProduct.stock} {t('common.units')}</p>
              </div>
            </div>

            {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}

            {/* Form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('merma.damagedQuantity')}</label>
                <div className="flex items-center gap-4 bg-white dark:bg-slate-800/95 p-2 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <button 
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 font-black text-xl active:scale-90 transition-all"
                  >
                    -
                  </button>
                  <div className="flex-1 text-center text-xl font-black text-slate-900 dark:text-slate-100">{quantity}</div>
                  <button 
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 font-black text-xl active:scale-90 transition-all"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('merma.reason')}</label>
                <select 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800/95 border border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-rose-500 outline-none transition-all font-bold text-slate-700 dark:text-slate-100 shadow-sm appearance-none"
                >
                  <option value="">{t('merma.selectReason')}</option>
                  <option value="damaged">{t('merma.damagedPackaging')}</option>
                  <option value="expired">{t('merma.expired')}</option>
                  <option value="broken">{t('merma.broken')}</option>
                  <option value="defect">{t('merma.defect')}</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Ubicación origen</label>
                <select
                  value={sourceLocationId}
                  onChange={(e) => {
                    const nextValue = e.target.value === '' ? '' : Number(e.target.value);
                    setSourceLocationId(nextValue);
                    setDestinationLocationId('');
                  }}
                  className="w-full bg-white dark:bg-slate-800/95 border border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-rose-500 outline-none transition-all font-bold text-slate-700 dark:text-slate-100 shadow-sm appearance-none"
                >
                  <option value="">Seleccione origen</option>
                  {sourceLocations.map((location) => (
                    <option key={location.LocationID} value={location.LocationID}>
                      {location.LocationName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Ubicación destino</label>
                <select
                  value={destinationLocationId}
                  onChange={(e) => setDestinationLocationId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-white dark:bg-slate-800/95 border border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-rose-500 outline-none transition-all font-bold text-slate-700 dark:text-slate-100 shadow-sm appearance-none"
                >
                  <option value="">Seleccione destino</option>
                  {destinationOptionsForSelectedSource.map((location) => (
                    <option key={location.LocationID} value={location.LocationID}>
                      {location.LocationName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('merma.photoEvidence')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {photos.map((photo, i) => (
                    <div key={i} className="aspect-square rounded-2xl overflow-hidden relative group">
                      <img src={photo} alt="Evidencia" className="w-full h-full object-cover" />
                      <button 
                        onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {photos.length < 3 && (
                    <button 
                      onClick={handleAddPhoto}
                      className="aspect-square bg-slate-50 dark:bg-slate-700/70 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-2xl flex flex-col items-center justify-center text-slate-400 dark:text-slate-300 gap-1 active:bg-slate-100 dark:active:bg-slate-600 transition-all"
                    >
                      <Camera size={24} />
                      <span className="text-[8px] font-black uppercase">{t('merma.capture')}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                onClick={() => setStep('scan')}
                className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                {t('merma.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!reason || isSubmitting}
                className="flex-1 bg-rose-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-rose-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
                <span>{t('merma.submit')}</span>
              </button>
            </div>
          </motion.div>
        )}

        {step === 'success' && (
          <motion.div 
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-12 space-y-8"
          >
            <div className="w-32 h-32 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-2xl shadow-emerald-500/40">
              <Check size={64} strokeWidth={3} />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">{t('merma.reportSent')}</h2>
              <p className="text-slate-500 dark:text-slate-300 font-medium px-8">{t('merma.reportSuccess')}</p>
            </div>
            <button 
              onClick={() => setStep('scan')}
              className="w-full bg-slate-900 text-white py-6 rounded-[2rem] font-black uppercase tracking-widest active:scale-95 transition-all"
            >
              {t('merma.newReport')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
};
