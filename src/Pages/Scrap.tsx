import React, { useEffect, useState } from 'react';
import {
  Trash2,
  Scan,
  Check,
  LoaderCircle,
  AlertTriangle,
  MapPin,
  Package,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import { notifyAppRefresh, useAppRefresh } from '../utils/realtime';

interface LotInfo {
  LotInventoryID: number;
  LotReceiveID: number | null;
  PartNumber: string;
  PartName: string;
  UnitType: string;
  CurrentInternalLot: string | null;
  CurrentQuantity: number;
  CurrentLocationID: number | null;
  CurrentLocationName: string | null;
}

interface LookupResult {
  lot: LotInfo;
  isInQuarantine: boolean;
  quarantineLocationId: number | null;
  quarantineLocationName: string | null;
  baseLocationId: number | null;
  baseLocationName: string | null;
}

interface ScrapRequestRow {
  RequestID: number;
  RequestStatusID: number;
  RequestTypeID: number;
  PartNumber: string;
  PartName?: string;
  Quantity: number | string;
  SourceLocationName?: string;
  DestinationLocationName?: string;
}

interface QuarantineLocationSummary {
  LocationID: number;
  LocationNumber: number;
  LocationName: string;
  lotCount: number;
}

interface SelectedQuarantineLocation {
  LocationID: number;
  LocationName: string;
  pairedLocationId: number | null;
  pairedLocationName: string | null;
}

interface QuarantineLot {
  LotInventoryID: number;
  LotReceiveID: number | null;
  PartNumber: string;
  PartName: string;
  CurrentInternalLot: string | null;
  CurrentQuantity: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const REASON_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'damaged', labelKey: 'scrap.damagedPackaging' },
  { value: 'expired', labelKey: 'scrap.expired' },
  { value: 'broken', labelKey: 'scrap.broken' },
  { value: 'defect', labelKey: 'scrap.defect' },
];

const requestStatusLabel = (status: number) => {
  switch (status) {
    case 40:
      return 'Pendiente';
    case 41:
      return 'Aprobada';
    default:
      return String(status);
  }
};

export const Scrap: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  const [step, setStep] = useState<'scan' | 'createTransfer' | 'lotActions' | 'scrapDownForm' | 'success'>('scan');
  const [scrapTab, setScrapTab] = useState<'history' | 'quarantine'>('quarantine');

  const [scanCode, setScanCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  const [historyRequests, setHistoryRequests] = useState<ScrapRequestRow[]>([]);
  const [historyPagination, setHistoryPagination] = useState<Pagination | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<40 | 41>(40);

  const [quarantineLocations, setQuarantineLocations] = useState<QuarantineLocationSummary[]>([]);
  const [quarantineLocationsLoading, setQuarantineLocationsLoading] = useState(false);
  const [quarantineLocationsError, setQuarantineLocationsError] = useState('');

  const [selectedQuarantineLocation, setSelectedQuarantineLocation] = useState<SelectedQuarantineLocation | null>(null);
  const [quarantineLots, setQuarantineLots] = useState<QuarantineLot[]>([]);
  const [quarantineLotsPagination, setQuarantineLotsPagination] = useState<Pagination | null>(null);
  const [quarantineLotsLoading, setQuarantineLotsLoading] = useState(false);
  const [quarantineLotsError, setQuarantineLotsError] = useState('');

  const [transferQuantity, setTransferQuantity] = useState(1);
  const [transferReason, setTransferReason] = useState('');
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [scrapQuantity, setScrapQuantity] = useState(1);
  const [scrapReason, setScrapReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadHistory = async (page = 1, showLoading = true, status: 40 | 41 = historyStatusFilter) => {
    try {
      if (showLoading) {
        setHistoryLoading(true);
        setHistoryError('');
      }
      const response = await fetch(`/api/scrap/requests?page=${page}&status=${status}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las solicitudes de scrap.');
      setHistoryRequests(Array.isArray(data.requests) ? data.requests : []);
      setHistoryPagination(data.pagination || null);
    } catch (err) {
      if (showLoading) {
        setHistoryError(err instanceof Error ? err.message : 'No se pudieron cargar las solicitudes de scrap.');
        setHistoryRequests([]);
      }
    } finally {
      if (showLoading) setHistoryLoading(false);
    }
  };

  const loadQuarantineLocations = async (showLoading = true) => {
    try {
      if (showLoading) {
        setQuarantineLocationsLoading(true);
        setQuarantineLocationsError('');
      }
      const response = await fetch('/api/scrap/quarantine-locations');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar las ubicaciones de cuarentena.');
      setQuarantineLocations(Array.isArray(data.locations) ? data.locations : []);
    } catch (err) {
      if (showLoading) {
        setQuarantineLocationsError(err instanceof Error ? err.message : 'No se pudieron cargar las ubicaciones de cuarentena.');
        setQuarantineLocations([]);
      }
    } finally {
      if (showLoading) setQuarantineLocationsLoading(false);
    }
  };

  const loadQuarantineLots = async (locationId: number, page = 1) => {
    try {
      setQuarantineLotsLoading(true);
      setQuarantineLotsError('');
      const response = await fetch(`/api/scrap/quarantine-locations/${locationId}/lots?page=${page}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se pudieron cargar los lotes de la ubicación.');
      setQuarantineLots(Array.isArray(data.lots) ? data.lots : []);
      setQuarantineLotsPagination(data.pagination || null);
      setSelectedQuarantineLocation((prev) =>
        prev
          ? {
              ...prev,
              pairedLocationId: data.location?.pairedLocationId ?? null,
              pairedLocationName: data.location?.pairedLocationName ?? null,
            }
          : prev
      );
    } catch (err) {
      setQuarantineLotsError(err instanceof Error ? err.message : 'No se pudieron cargar los lotes.');
      setQuarantineLots([]);
    } finally {
      setQuarantineLotsLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory(1);
    void loadQuarantineLocations();
  }, []);

  const handleHistoryStatusFilterChange = (status: 40 | 41) => {
    if (status === historyStatusFilter) return;
    setHistoryStatusFilter(status);
    void loadHistory(1, true, status);
  };

  useAppRefresh(() => {
    if (step !== 'scan') return;
    if (scrapTab === 'history') {
      void loadHistory(historyPagination?.page || 1, false);
    } else if (selectedQuarantineLocation) {
      void loadQuarantineLots(selectedQuarantineLocation.LocationID, quarantineLotsPagination?.page || 1);
    } else {
      void loadQuarantineLocations(false);
    }
  }, 10000);

  const openLotActions = (result: LookupResult) => {
    setLookupResult(result);
    setReturnQuantity(result.lot.CurrentQuantity || 1);
    setScrapQuantity(result.lot.CurrentQuantity || 1);
    setTransferQuantity(result.lot.CurrentQuantity || 1);
    setTransferReason('');
    setScrapReason('');
    setFormError('');
    setStep(result.isInQuarantine ? 'lotActions' : 'createTransfer');
  };

  const openQuarantineLot = (lot: QuarantineLot) => {
    if (!selectedQuarantineLocation) return;
    const result: LookupResult = {
      lot: {
        LotInventoryID: lot.LotInventoryID,
        LotReceiveID: lot.LotReceiveID,
        PartNumber: lot.PartNumber,
        PartName: lot.PartName,
        UnitType: '',
        CurrentInternalLot: lot.CurrentInternalLot,
        CurrentQuantity: lot.CurrentQuantity,
        CurrentLocationID: selectedQuarantineLocation.LocationID,
        CurrentLocationName: selectedQuarantineLocation.LocationName,
      },
      isInQuarantine: true,
      quarantineLocationId: selectedQuarantineLocation.LocationID,
      quarantineLocationName: selectedQuarantineLocation.LocationName,
      baseLocationId: selectedQuarantineLocation.pairedLocationId,
      baseLocationName: selectedQuarantineLocation.pairedLocationName,
    };
    openLotActions(result);
  };

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code) {
      setScanError('Ingresa un código, part number o lote para localizar el producto.');
      return;
    }
    try {
      setIsScanning(true);
      setScanError('');
      const response = await fetch(`/api/scrap/lookup?code=${encodeURIComponent(code)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'No se encontró el producto ni el lote con esa referencia.');
      openLotActions(data as LookupResult);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'No se pudo localizar el producto.');
    } finally {
      setIsScanning(false);
    }
  };

  const resetToScan = () => {
    setStep('scan');
    setScanCode('');
    setScanError('');
    setLookupResult(null);
    setSelectedQuarantineLocation(null);
    setFormError('');
    void loadHistory(1);
    void loadQuarantineLocations();
  };

  const handleCreateTransfer = async () => {
    if (!lookupResult) return;
    const { lot, baseLocationId, quarantineLocationId } = lookupResult;
    if (!baseLocationId || !quarantineLocationId) {
      setFormError('No se pudo determinar la ubicación de cuarentena pareja de este lote.');
      return;
    }
    if (!transferQuantity || transferQuantity <= 0) {
      setFormError('La cantidad debe ser mayor a cero.');
      return;
    }
    try {
      setIsSubmitting(true);
      setFormError('');
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestTypeID: 2,
          PartNumber: lot.PartNumber,
          Quantity: transferQuantity,
          RegUserID: user?.id ? Number(user.id) : null,
          SourceLocationID: baseLocationId,
          DestinationLocationID: quarantineLocationId,
          LotInventoryID: lot.LotInventoryID,
          Comments: transferReason ? `${transferReason} | ${user?.name || 'Usuario'}` : undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo crear la solicitud de transferencia.');
      setSuccessMessage(`Solicitud de transferencia #${body.requestId} creada y sincronizada con el MES WEB. Queda pendiente de aprobación.`);
      notifyAppRefresh('action');
      setStep('success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear la solicitud.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnToOrigin = async () => {
    if (!lookupResult) return;
    const { lot, baseLocationId, quarantineLocationId } = lookupResult;
    if (!baseLocationId || !quarantineLocationId) {
      setFormError('No se pudo determinar la ubicación de origen de este lote.');
      return;
    }
    if (!returnQuantity || returnQuantity <= 0) {
      setFormError('La cantidad debe ser mayor a cero.');
      return;
    }
    try {
      setIsSubmitting(true);
      setFormError('');
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestTypeID: 2,
          PartNumber: lot.PartNumber,
          Quantity: returnQuantity,
          RegUserID: user?.id ? Number(user.id) : null,
          SourceLocationID: quarantineLocationId,
          DestinationLocationID: baseLocationId,
          LotInventoryID: lot.LotInventoryID,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo crear la solicitud de devolución.');
      setSuccessMessage(`Solicitud de devolución #${body.requestId} creada y sincronizada con el MES WEB. Queda pendiente de aprobación.`);
      notifyAppRefresh('action');
      setStep('success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear la solicitud.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScrapDown = async () => {
    if (!lookupResult) return;
    const { lot, quarantineLocationId } = lookupResult;
    if (!quarantineLocationId) {
      setFormError('No se pudo determinar la ubicación de origen de esta baja.');
      return;
    }
    if (!scrapReason) {
      setFormError('Selecciona un motivo de scrap antes de enviar la solicitud.');
      return;
    }
    if (!scrapQuantity || scrapQuantity <= 0) {
      setFormError('La cantidad debe ser mayor a cero.');
      return;
    }
    try {
      setIsSubmitting(true);
      setFormError('');
      const response = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestTypeID: 6,
          PartNumber: lot.PartNumber,
          Quantity: scrapQuantity,
          RegUserID: user?.id ? Number(user.id) : null,
          SourceLocationID: quarantineLocationId,
          // El backend fuerza este valor a la ubicación "Confirmed Scrap" (LocationID 19)
          // para cualquier solicitud tipo 6 sin importar lo que se envíe aquí.
          DestinationLocationID: 19,
          LotInventoryID: lot.LotInventoryID,
          Comments: `${scrapReason} | ${user?.name || 'Usuario'}`,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'No se pudo crear la solicitud de baja.');
      setSuccessMessage(`Solicitud de baja #${body.requestId} creada y sincronizada con el MES WEB. Queda pendiente de aprobación.`);
      notifyAppRefresh('action');
      setStep('success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo crear la solicitud.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openQuarantineLocation = (location: QuarantineLocationSummary) => {
    setSelectedQuarantineLocation({
      LocationID: location.LocationID,
      LocationName: location.LocationName,
      pairedLocationId: null,
      pairedLocationName: null,
    });
    void loadQuarantineLots(location.LocationID, 1);
  };

  const backToQuarantineLocations = () => {
    setSelectedQuarantineLocation(null);
    setQuarantineLots([]);
    setQuarantineLotsPagination(null);
    void loadQuarantineLocations();
  };

  const renderPagination = (pagination: Pagination | null, onChange: (page: number) => void) => {
    if (!pagination || pagination.totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, pagination.page - 1))}
          disabled={pagination.page <= 1}
          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <ChevronLeft size={14} />
          Anterior
        </button>
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          Página {pagination.page} de {pagination.totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(pagination.totalPages, pagination.page + 1))}
          disabled={pagination.page >= pagination.totalPages}
          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          Siguiente
          <ChevronRight size={14} />
        </button>
      </div>
    );
  };

  return (
    <Layout title={t('scrap.title')}>
      <AnimatePresence mode="wait">
        {step === 'scan' && (
          <motion.div
            key="scan"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center py-8 space-y-8"
          >
            <div className="w-40 h-40 bg-rose-50 dark:bg-rose-500/10 rounded-[3rem] flex items-center justify-center text-rose-500 border-4 border-dashed border-rose-200 dark:border-rose-500/30">
              <Trash2 size={80} />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">{t('scrap.reportDamage')}</h2>
            </div>
            <div className="w-full space-y-3">
              <input
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                placeholder="Escanea o escribe código, part number o lote"
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/95 px-4 py-4 text-sm font-semibold text-slate-700 dark:text-slate-100 outline-none"
              />
              {scanError && <p className="text-sm font-semibold text-rose-600">{scanError}</p>}
              <button
                onClick={handleScan}
                disabled={isScanning}
                className="w-full bg-slate-900 text-white py-6 rounded-[2rem] font-black uppercase tracking-widest flex items-center justify-center gap-4 shadow-2xl shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-60"
              >
                {isScanning ? <LoaderCircle size={28} className="animate-spin" /> : <Scan size={28} />}
                <span>{t('scrap.scanProductAction')}</span>
              </button>
            </div>

            <div className="w-full rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white/90 dark:bg-slate-800/80 p-4 shadow-sm space-y-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-2">
                <button
                  type="button"
                  onClick={() => setScrapTab('quarantine')}
                  className={`flex-1 rounded-2xl py-3 text-sm font-black uppercase tracking-widest transition ${scrapTab === 'quarantine' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                >
                  {t('scrap.quarantineTab')}
                </button>
                <button
                  type="button"
                  onClick={() => setScrapTab('history')}
                  className={`flex-1 rounded-2xl py-3 text-sm font-black uppercase tracking-widest transition ${scrapTab === 'history' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                >
                  {t('scrap.historyTab')}
                </button>
              </div>

              {scrapTab === 'history' ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleHistoryStatusFilterChange(40)}
                      className={`flex-1 rounded-xl py-2 text-[11px] font-black uppercase tracking-widest transition ${historyStatusFilter === 40 ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 dark:bg-slate-900/60 dark:text-slate-300'}`}
                    >
                      Pendiente
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHistoryStatusFilterChange(41)}
                      className={`flex-1 rounded-xl py-2 text-[11px] font-black uppercase tracking-widest transition ${historyStatusFilter === 41 ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 dark:bg-slate-900/60 dark:text-slate-300'}`}
                    >
                      Aprobada
                    </button>
                  </div>
                  {historyLoading ? (
                    <p className="text-sm font-semibold text-slate-500">Cargando solicitudes...</p>
                  ) : historyError ? (
                    <p className="text-sm font-semibold text-rose-600">{historyError}</p>
                  ) : historyRequests.length === 0 ? (
                    <p className="text-sm font-semibold text-slate-500">No hay solicitudes de scrap registradas.</p>
                  ) : (
                    <div className="space-y-3">
                      {historyRequests.map((request) => (
                        <div key={request.RequestID} className="rounded-2xl bg-white dark:bg-slate-700/70 px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-black text-slate-800 dark:text-slate-100">{request.PartName || request.PartNumber}</p>
                              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">
                                {request.SourceLocationName || 'Origen no definido'}
                                {request.DestinationLocationName ? ` → ${request.DestinationLocationName}` : ''}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-rose-600">{request.Quantity} {t('common.units')}</p>
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{requestStatusLabel(request.RequestStatusID)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {renderPagination(historyPagination, (page) => void loadHistory(page))}
                </div>
              ) : !selectedQuarantineLocation ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-3">
                  {quarantineLocationsLoading ? (
                    <p className="text-sm font-semibold text-slate-500">Cargando ubicaciones...</p>
                  ) : quarantineLocationsError ? (
                    <p className="text-sm font-semibold text-rose-600">{quarantineLocationsError}</p>
                  ) : (
                    <div className="space-y-3">
                      {quarantineLocations.map((location) => (
                        <button
                          key={location.LocationID}
                          type="button"
                          onClick={() => openQuarantineLocation(location)}
                          className="w-full flex items-center justify-between gap-2 rounded-2xl bg-white dark:bg-slate-700/70 px-4 py-3 text-left active:scale-[0.99] transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 flex items-center justify-center">
                              <MapPin size={18} />
                            </div>
                            <p className="text-sm font-black text-slate-800 dark:text-slate-100">{location.LocationName}</p>
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{location.lotCount} lotes</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4 space-y-3">
                  <button
                    type="button"
                    onClick={backToQuarantineLocations}
                    className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300"
                  >
                    <ArrowLeft size={14} /> Ubicaciones de cuarentena
                  </button>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-100">{selectedQuarantineLocation.LocationName}</p>

                  {quarantineLotsLoading ? (
                    <p className="text-sm font-semibold text-slate-500">Cargando lotes...</p>
                  ) : quarantineLotsError ? (
                    <p className="text-sm font-semibold text-rose-600">{quarantineLotsError}</p>
                  ) : quarantineLots.length === 0 ? (
                    <p className="text-sm font-semibold text-slate-500">No hay lotes en esta ubicación.</p>
                  ) : (
                    <div className="space-y-3">
                      {quarantineLots.map((lot) => (
                        <button
                          key={lot.LotInventoryID}
                          type="button"
                          onClick={() => openQuarantineLot(lot)}
                          className="w-full flex items-center justify-between gap-2 rounded-2xl bg-white dark:bg-slate-700/70 px-4 py-3 text-left active:scale-[0.99] transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-600/60 text-slate-500 dark:text-slate-200 flex items-center justify-center">
                              <Package size={18} />
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-800 dark:text-slate-100">{lot.PartName || lot.PartNumber}</p>
                              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">Lote: {lot.CurrentInternalLot || lot.LotReceiveID}</p>
                            </div>
                          </div>
                          <span className="text-sm font-black text-slate-700 dark:text-slate-200">{lot.CurrentQuantity} {t('common.units')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {renderPagination(quarantineLotsPagination, (page) => void loadQuarantineLots(selectedQuarantineLocation.LocationID, page))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 'createTransfer' && lookupResult && (
          <motion.div
            key="createTransfer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-500/10 dark:text-amber-100 flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>{t('scrap.notInQuarantineWarning')}</span>
            </div>

            <div className="bg-white dark:bg-slate-800/95 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
              <div>
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">{lookupResult.lot.PartNumber}</span>
                <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">{lookupResult.lot.PartName}</h3>
                {lookupResult.lot.CurrentInternalLot && (
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">Lote: {lookupResult.lot.CurrentInternalLot}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/70 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('scrap.originLabel')}</p>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-100">{lookupResult.baseLocationName || '—'}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/70 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Destino (cuarentena)</p>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-100">{lookupResult.quarantineLocationName || '—'}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('scrap.damagedQuantity')}</label>
                <div className="flex items-center justify-center bg-slate-50 dark:bg-slate-900/70 p-4 rounded-2xl">
                  <div className="text-center text-xl font-black text-slate-900 dark:text-slate-100">{lookupResult.lot.CurrentQuantity}</div>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Se transfiere el lote completo a cuarentena (no se permiten transferencias parciales).</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('scrap.reason')}</label>
                <select
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800/95 border border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 outline-none font-bold text-slate-700 dark:text-slate-100 shadow-sm appearance-none"
                >
                  <option value="">{t('scrap.selectReason')}</option>
                  {REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </div>

              {formError && <p className="text-sm font-semibold text-rose-600">{formError}</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetToScan}
                className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                {t('scrap.cancel')}
              </button>
              <button
                onClick={handleCreateTransfer}
                disabled={isSubmitting}
                className="flex-1 bg-rose-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-rose-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
                <span>{t('scrap.submit')}</span>
              </button>
            </div>
          </motion.div>
        )}

        {step === 'lotActions' && lookupResult && (
          <motion.div
            key="lotActions"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="bg-white dark:bg-slate-800/95 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm space-y-2">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">{lookupResult.lot.PartNumber}</span>
              <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">{lookupResult.lot.PartName}</h3>
              {lookupResult.lot.CurrentInternalLot && (
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">Lote: {lookupResult.lot.CurrentInternalLot}</p>
              )}
              <div className="flex items-center justify-between pt-2">
                <span className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em]">
                  {lookupResult.quarantineLocationName}
                </span>
                <span className="text-lg font-black text-slate-800 dark:text-slate-100">{lookupResult.lot.CurrentQuantity} {t('common.units')}</span>
              </div>
            </div>

            {formError && <p className="text-sm font-semibold text-rose-600">{formError}</p>}

            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => void handleReturnToOrigin()}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-800/95 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
              >
                {isSubmitting ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCcw size={18} />}
                <span>{t('scrap.returnToOrigin')}</span>
              </button>
              <button
                type="button"
                onClick={() => setStep('scrapDownForm')}
                className="w-full flex items-center justify-center gap-3 bg-rose-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-rose-500/20 active:scale-95 transition-all"
              >
                <Trash2 size={18} />
                <span>{t('scrap.scrapDown')}</span>
              </button>
              <button
                type="button"
                onClick={resetToScan}
                className="w-full text-center text-xs font-black uppercase tracking-widest text-slate-400 py-2"
              >
                {t('scrap.cancel')}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'scrapDownForm' && lookupResult && (
          <motion.div
            key="scrapDownForm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="bg-white dark:bg-slate-800/95 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm space-y-5">
              <div>
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest">{lookupResult.lot.PartNumber}</span>
                <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">{lookupResult.lot.PartName}</h3>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('scrap.damagedQuantity')}</label>
                <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/70 p-2 rounded-2xl">
                  <button
                    onClick={() => setScrapQuantity((q) => Math.max(1, q - 1))}
                    className="w-12 h-12 bg-white dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-200 font-black text-xl active:scale-90 transition-all"
                  >
                    -
                  </button>
                  <div className="flex-1 text-center text-xl font-black text-slate-900 dark:text-slate-100">{scrapQuantity}</div>
                  <button
                    onClick={() => setScrapQuantity((q) => Math.min(lookupResult.lot.CurrentQuantity, q + 1))}
                    className="w-12 h-12 bg-white dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-200 font-black text-xl active:scale-90 transition-all"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Máximo disponible: {lookupResult.lot.CurrentQuantity}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('scrap.reason')}</label>
                <select
                  value={scrapReason}
                  onChange={(e) => setScrapReason(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800/95 border border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 outline-none font-bold text-slate-700 dark:text-slate-100 shadow-sm appearance-none"
                >
                  <option value="">{t('scrap.selectReason')}</option>
                  {REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/70 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('scrap.originLabel')}</p>
                <p className="text-sm font-black text-slate-800 dark:text-slate-100">{lookupResult.quarantineLocationName || '—'}</p>
              </div>

              {formError && <p className="text-sm font-semibold text-rose-600">{formError}</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('lotActions')}
                className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                {t('scrap.cancel')}
              </button>
              <button
                onClick={handleScrapDown}
                disabled={isSubmitting}
                className="flex-1 bg-rose-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-rose-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
                <span>{t('scrap.submit')}</span>
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
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">{t('scrap.reportSent')}</h2>
              <p className="text-slate-500 dark:text-slate-300 font-medium px-8">{successMessage}</p>
            </div>
            <button
              onClick={resetToScan}
              className="w-full bg-slate-900 text-white py-6 rounded-[2rem] font-black uppercase tracking-widest active:scale-95 transition-all"
            >
              {t('scrap.newReport')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
};

export default Scrap;
