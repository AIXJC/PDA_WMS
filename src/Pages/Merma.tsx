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
  const [step, setStep] = useState<'scan' | 'details' | 'success' | 'requestDetails'>('scan');
  const [scrapTab, setScrapTab] = useState<'pending' | 'executed'>('pending');
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
  const [scrapRequests, setScrapRequests] = useState<any[]>([]);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [selectedScrapRequest, setSelectedScrapRequest] = useState<any | null>(null);
  const [scrapRequestReason, setScrapRequestReason] = useState('');
  const [scrapRequestQuantity, setScrapRequestQuantity] = useState(0);
  const [isProcessingScrapRequest, setIsProcessingScrapRequest] = useState(false);
  const [scrapRequestSuccess, setScrapRequestSuccess] = useState('');
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

  const loadScrapRequests = async (showLoading = true) => {
    try {
      if (showLoading) {
        setRequestLoading(true);
      }
      if (showLoading) {
        setRequestError('');
      }
      const response = await fetch('/api/scrap/requests');
      if (!response.ok) throw new Error('No se pudieron cargar las solicitudes de scrap.');
      const data = await response.json();    
      setScrapRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (err) {
      if (showLoading) {
        setRequestError(err instanceof Error ? err.message : 'No se pudieron cargar las solicitudes de scrap.');
        setScrapRequests([]);
      }
    } finally {
      if (showLoading) {
        setRequestLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadRecentScrap();
    void loadScrapRequests();
  }, []);

  useAppRefresh(() => {
    void loadRecentScrap(false);
    void loadScrapRequests(false);
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
  const isScrapDestination = (location: LocationOption) => {
    const name = String(location.LocationName || '').toLowerCase();
    return name.includes('quarantine') || name.includes('purg') || name.includes('cuarentena') || name.includes('purgue');
  };
  const scrapDestinationOptionsBySource = destinationOptionsForSelectedSource.filter(isScrapDestination);
  const scrapDestinationOptions = destinationLocations.filter(isScrapDestination);
  const pendingFollowUpScrap = recentScrap.filter((item) => String(item.Comments || '').includes('SCRAP_PENDIENTE'));
  const pendingScrapRequests = scrapRequests.filter((request) => Number(request.RequestStatusID) === 40);
  // Include both approved (41) and executed (42) in the approved tab
  const executedScrapRequests = scrapRequests.filter((request) => Number(request.RequestStatusID) === 41);
  const selectedScrapRequestAvailableQty = selectedScrapRequest ? Number(selectedScrapRequest.CurrentQuantity ?? selectedScrapRequest.LotCurrentQuantity ?? 0) : 0;
  const selectedScrapRequestMaxQty = selectedScrapRequest ? Math.min(Number(selectedScrapRequest.Quantity ?? 0), selectedScrapRequestAvailableQty) : 0;
  const requestStatusLabel = (status: number) => {
    switch (status) {
      case 40:
        return 'Pendiente';
      case 41:
        return 'Aprobada';
      case 42:
        return 'Ejecutada';
      default:
        return String(status);
    }
  };

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code) {
      setError('Ingresa un código, part number o lote para localizar el producto.');
      return;
    }

    try {
      setIsScanning(true);
      setError('');
      const response = await fetch(`/api/scanner/${encodeURIComponent(code)}`);
      if (!response.ok) throw new Error('No se pudo localizar el producto.');
      const data = await response.json();

      let scanned: any = null;
      if (data.found) {
        const inventoryItem = Array.isArray(data.inventory) && data.inventory.length > 0 ? data.inventory[0] : null;
        const packItem = Array.isArray(data.packs) && data.packs.length > 0 ? data.packs[0] : null;
        if (inventoryItem || packItem) {
          scanned = {
            sku: inventoryItem?.PartNumber || packItem?.PartNumber || code,
            name: inventoryItem?.PartName || packItem?.PartName || code,
            stock: inventoryItem?.Quantity ?? packItem?.Quantity ?? 0,
            unitType: inventoryItem?.UnitType || '',
            locationId: inventoryItem?.LocationID ?? packItem?.SourceLocationID ?? null,
            locationName: inventoryItem?.LocationName || packItem?.sourceLocationName || '',
          };
        }
      }

      if (!scanned) {
        const lotResponse = await fetch(`/api/requests/lots?lotReference=${encodeURIComponent(code)}&limit=1`);
        if (!lotResponse.ok) throw new Error('No se encontró el lote.');
        const lotData = await lotResponse.json();
        const lotMatch = Array.isArray(lotData.lots) && lotData.lots.length > 0 ? lotData.lots[0] : null;
        if (lotMatch) {
          scanned = {
            sku: lotMatch.PartNumber || code,
            name: lotMatch.PartName || lotMatch.PartNumber || code,
            stock: lotMatch.CurrentQuantity ?? 0,
            unitType: lotMatch.UnitType || '',
            locationId: lotMatch.CurrentLocationID ?? null,
            locationName: lotMatch.CurrentLocationID ? String(lotMatch.CurrentLocationID) : '',
            lotReference: lotMatch.CurrentInternalLot || lotMatch.InternalLot || lotMatch.ShortInternalLot || String(lotMatch.ReceiveID ?? lotMatch.LotReceiveID ?? ''),
            lotInventoryId: lotMatch.LotInventoryID ?? null,
            lotReceiveId: lotMatch.ReceiveID ?? null,
          };
        }
      }

      if (!scanned) {
        throw new Error('No se encontró el producto ni el lote con esa referencia.');
      }

      setScannedProduct(scanned);
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

  const handleSelectScrapRequest = (request: any) => {
    setSelectedScrapRequest(request);
    setScrapRequestReason('');
    setScrapRequestSuccess('');
    const availableQty = Number(request.CurrentQuantity ?? request.LotCurrentQuantity ?? 0);
    const requestQty = Number(request.Quantity ?? 0);
    setScrapRequestQuantity(Math.min(availableQty, requestQty) || 0);
    setStep('requestDetails');
  };

  const handleProcessScrapRequest = async () => {
    if (!selectedScrapRequest) return;
    if (!scrapRequestReason) {
      setRequestError('Selecciona un motivo de scrap antes de procesar la solicitud.');
      return;
    }
    if (!scrapRequestQuantity || scrapRequestQuantity <= 0) {
      setRequestError('La cantidad de scrap debe ser mayor a cero.');
      return;
    }

    try {
      setIsProcessingScrapRequest(true);
      setRequestError('');
      const response = await fetch(`/api/scrap/requests/${selectedScrapRequest.RequestID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: scrapRequestQuantity,
          scrapType: scrapRequestReason,
          comments: `Scrap aprobado | ${user?.name || 'Usuario'}`,
          regUserId: user?.id ? Number(user.id) : null,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message || 'No se pudo procesar la solicitud de scrap.');
      }

      try {
        console.log({
            request_id: selectedScrapRequest.RequestID,
            request_type_id: selectedScrapRequest.RequestTypeID,
            qty: scrapRequestQuantity,
            batch_no: selectedScrapRequest.CurrentInternalLot
          })

        const responseERP = await fetch('/api/erp/submit-stock-entry', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: selectedScrapRequest.RequestID,
            request_type_id: selectedScrapRequest.RequestTypeID,
            qty: scrapRequestQuantity,
            batch_no: selectedScrapRequest.CurrentInternalLot
          }),
        });
        const dataERP = await responseERP.json();
          if (!responseERP.ok) {
            throw new Error('Error al actualizar el movimiento en MES Web');
          }
          alert('Transferencia confirmada correctamente.');
        } catch (erpError: unknown) {
          const erpMessage = erpError instanceof Error ? erpError.message : String(erpError);
          alert(`Transferencia confirmada correctamente, pero falló la sincronización con el ERP: ${erpMessage}`);
      }

      const successMessage = body.newScrapRequestId
        ? `Scrap procesado correctamente. Se creó solicitud de scrap #${body.newScrapRequestId}.`
        : 'Scrap procesado correctamente.';      

      setScrapRequestSuccess(successMessage);
      await loadScrapRequests(false);
      await loadRecentScrap(false);
      setSelectedScrapRequest(null);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'No se pudo procesar la solicitud de scrap.');
    } finally {
      setIsProcessingScrapRequest(false);
    }
  };

  const handleSubmit = async () => {
    if (!scannedProduct) return;
    if (sourceLocationId === '' || sourceLocationId == null) {
      setError('Selecciona una ubicación de origen antes de enviar la solicitud.');
      return;
    }
    if (destinationLocationId === '' || destinationLocationId == null) {
      setError('Selecciona una ubicación de destino antes de enviar la solicitud.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestTypeID: 6,
          PartNumber: scannedProduct.sku,
          Quantity: quantity,
          RegUserID: user?.id ? Number(user.id) : null,
          SourceLocationID: Number(sourceLocationId),
          DestinationLocationID: Number(destinationLocationId),
          Comments: reason ? `${reason} | ${user?.name || 'Usuario'} | ${scannedProduct.locationName || 'Sin ubicación'}` : `${user?.name || 'Usuario'} | ${scannedProduct.locationName || 'Sin ubicación'}`,
          LotInventoryID: scannedProduct.lotInventoryId ?? null,
          LotReceiveID: scannedProduct.lotReceiveId ?? null,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message || 'No se pudo crear la solicitud de scrap.');
      }

      const responseERP = await fetch(
        '/api/erp/create-stock-entry',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: body.requestId,
            request_type_id: 6,
          }),
        }
      )

      const dataERP = await responseERP.json();

      if (!responseERP.ok) {
        throw new Error(
          dataERP.message || 'Error al crear el movimiento en MES Web'
        );
      }

      await loadScrapRequests(false);
      notifyAppRefresh('action');
      setPhotos([]);
      setReason('');
      setQuantity(1);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la solicitud de scrap.');
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
                placeholder="Escanea o escribe código, part number o lote"
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

              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-2">
                  <button
                    type="button"
                    onClick={() => setScrapTab('pending')}
                    className={`flex-1 rounded-2xl py-3 text-sm font-black uppercase tracking-widest transition ${scrapTab === 'pending' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    Pendientes
                  </button>
                  <button
                    type="button"
                    onClick={() => setScrapTab('executed')}
                    className={`flex-1 rounded-2xl py-3 text-sm font-black uppercase tracking-widest transition ${scrapTab === 'executed' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    Ejecutadas
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                      {scrapTab === 'pending' ? 'Solicitudes Pendientes' : 'Solicitudes Ejecutadas'}
                    </h3>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                      {scrapTab === 'pending' ? pendingScrapRequests.length : executedScrapRequests.length}
                    </span>
                  </div>

                  {requestLoading ? (
                    <p className="text-sm font-semibold text-slate-500">Cargando solicitudes...</p>
                  ) : requestError ? (
                    <p className="text-sm font-semibold text-rose-600">{requestError}</p>
                  ) : (scrapTab === 'pending' ? pendingScrapRequests : executedScrapRequests).length === 0 ? (
                    <p className="text-sm font-semibold text-slate-500">
                      {scrapTab === 'pending' ? 'No hay solicitudes pendientes.' : 'No hay solicitudes ejecutadas.'}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {(scrapTab === 'pending' ? pendingScrapRequests : executedScrapRequests).map((request) => (
                        <div key={request.RequestID} className="rounded-2xl bg-white dark:bg-slate-700/70 px-3 py-3">
                          <button
                            type="button"
                            onClick={() => handleSelectScrapRequest(request)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-black text-slate-800 dark:text-slate-100">{request.PartName || request.PartNumber}</p>
                                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">{request.SourceLocationName || 'Origen no definido'} → {request.DestinationLocationName || 'Destino no definido'}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-black text-rose-600">{request.Quantity} {t('common.units')}</p>
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{requestStatusLabel(request.RequestStatusID)}</p>
                              </div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </motion.div>
        )}

        {step === 'requestDetails' && selectedScrapRequest && (
          <motion.div
            key="requestDetails"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/95 p-5 shadow-sm">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Solicitud de Scrap</p>
                <h3 className="text-xl font-black text-slate-900 dark:text-slate-100">{selectedScrapRequest.PartName || selectedScrapRequest.PartNumber}</h3>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">{selectedScrapRequest.SourceLocationName || 'Origen no definido'} → {selectedScrapRequest.DestinationLocationName || 'Destino no definido'}</p>
              </div>
              <span className="rounded-2xl bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:bg-slate-700 dark:text-slate-200">{requestStatusLabel(selectedScrapRequest.RequestStatusID)}</span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Solicitud</p>
                <p className="mt-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100">{selectedScrapRequest.Quantity}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cantidad en lote</p>
                <p className="mt-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100">{selectedScrapRequest.CurrentQuantity ?? selectedScrapRequest.LotCurrentQuantity ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lote</p>
                <p className="mt-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100">{selectedScrapRequest.CurrentInternalLot || selectedScrapRequest.LotReceiveID || 'No definido'}</p>
              </div>
            </div>

            {selectedScrapRequest.RequestStatusID === 40 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-500/10 dark:text-amber-100">
                Esta solicitud está pendiente. No se puede procesar scrap hasta que sea aprobada.
              </div>
            ) : [41, 42].includes(Number(selectedScrapRequest.RequestStatusID)) ? (
              (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cantidad a scrap</label>
                      <input
                        type="number"
                        min={1}
                        max={selectedScrapRequestMaxQty}
                        value={scrapRequestQuantity}
                        onChange={(e) => setScrapRequestQuantity(Math.max(1, Math.min(Number(e.target.value), selectedScrapRequestMaxQty)))}
                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
                      />
                      <p className="text-[10px] text-slate-500 dark:text-slate-300">Máximo disponible: {selectedScrapRequestMaxQty}</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Motivo de scrap</label>
                      <select
                        value={scrapRequestReason}
                        onChange={(e) => setScrapRequestReason(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
                      >
                        <option value="">Selecciona un motivo</option>
                        <option value="damaged">Dañado</option>
                        <option value="expired">Caducado</option>
                        <option value="broken">Roto</option>
                        <option value="defect">Defecto</option>
                      </select>
                    </div>
                  </div>

                  {requestError && <p className="text-sm font-semibold text-rose-600">{requestError}</p>}
                  {scrapRequestSuccess && <p className="text-sm font-semibold text-emerald-600">{scrapRequestSuccess}</p>}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep('scan')}
                      className="flex-1 bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-4 rounded-2xl font-black uppercase tracking-widest"
                    >
                      Volver
                    </button>
                    <button
                      type="button"
                      onClick={handleProcessScrapRequest}
                      disabled={isProcessingScrapRequest}
                      className="flex-1 bg-rose-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-rose-500/20 disabled:opacity-50"
                    >
                      {isProcessingScrapRequest ? 'Procesando...' : 'Procesar Scrap'}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                Esta solicitud ya fue ejecutada (status 42). No es posible procesarla nuevamente.
              </div>
            )}
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
                      {scannedProduct.lotReference && (
                  <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-300">Lote: {scannedProduct.lotReference}</p>
                )}
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
                  {(scrapDestinationOptionsBySource.length > 0 ? scrapDestinationOptionsBySource : scrapDestinationOptions).map((location) => (
                    <option key={location.LocationID} value={location.LocationID}>
                      {location.LocationName}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Selecciona una ubicación de cuarentena/purgue para crear la solicitud de scrap.</p>
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
              <p className="text-slate-500 dark:text-slate-300 font-medium px-8">La solicitud de scrap fue creada y quedó pendiente de aprobación.</p>
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
