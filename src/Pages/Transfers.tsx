import React, { useEffect, useState } from 'react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { Check, ArrowRight, X, Box, ChevronLeft, ChevronRight } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { notifyAppRefresh, useAppRefresh } from '../utils/realtime';

type Req = {
  RequestID: number;
  RequestName: string;
  PartNumber: string;
  Quantity: number;
  SourceLocationID?: number;
  DestinationLocationID?: number;
  LotInventoryID?: number;
  LotReceiveID?: number;
  RequestStatusID?: number;
  RequestTypeID?: number;
};

type LotTraceability = {
  ReceiveID?: number;
  LotInventoryID?: number;
  CurrentLocationID?: number;
  InternalLot?: string;
  ProviderLot?: string;
  ShortInternalLot?: string;
  LocationName?: string;
};

type StorageLocation = {
  StorageID: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  LocationID?: number | null;
  LocationName?: string;
  Status?: 'available' | 'occupied';
};

export const Transfers: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [requests, setRequests] = useState<Req[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<number | null>(null);
  const [locationNames, setLocationNames] = useState<Record<number, string>>({});
  const [showStorageModal, setShowStorageModal] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<Req | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [lotTraceabilityByRequest, setLotTraceabilityByRequest] = useState<Record<number, LotTraceability | null>>({});
  const [defaultTransferQtyByRequest, setDefaultTransferQtyByRequest] = useState<Record<number, number>>({});
  const [showRackModal, setShowRackModal] = useState(false);
  const [rackRequest, setRackRequest] = useState<Req | null>(null);
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [loadingStorageLocations, setLoadingStorageLocations] = useState(false);
  const [selectedStorageLocation, setSelectedStorageLocation] = useState<StorageLocation | null>(null);
  const [rackCodeInput, setRackCodeInput] = useState('');
  const [completingRack, setCompletingRack] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => { void load(); }, []);

  useAppRefresh(() => {
    void load(false);
  }, 10000);

  useEffect(() => {
    const requestId = Number(new URLSearchParams(location.search).get('requestId'));
    if (!requestId || loading || showStorageModal) return;

    const matchedRequest = requests.find((item) => Number(item.RequestID) === requestId);
    if (matchedRequest) {
      void execute(matchedRequest);
      return;
    }

    // If not found in current list, try fetching single request by id (supports consumption requests redirected from Salidas)
    (async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}`);
        if (!res.ok) return;
        const data = await res.json();
        const req = data.request;
        if (req) {
          // Normalize shape to Req type
          const normalized: Req = {
            RequestID: Number(req.RequestID),
            RequestName: req.RequestName || '',
            PartNumber: req.PartNumber || '',
            Quantity: Number(req.Quantity || 0),
            SourceLocationID: req.SourceLocationID || undefined,
            DestinationLocationID: req.DestinationLocationID || undefined,
            LotInventoryID: req.LotInventoryID ? Number(req.LotInventoryID) : undefined,
            LotReceiveID: req.LotReceiveID ? Number(req.LotReceiveID) : undefined,
            RequestStatusID: req.RequestStatusID ? Number(req.RequestStatusID) : undefined,
            RequestTypeID: req.RequestTypeID ? Number(req.RequestTypeID) : undefined,
          };
          void execute(normalized);
        }
      } catch (e) {
        console.error('Error fetching request by id', e);
      }
    })();
  }, [location.search, loading, requests, showStorageModal]);

  async function loadLocationNames() {
    try {
      const r = await fetch('/api/scrap/location-options');
      const d = await r.json();
      const nextMap: Record<number, string> = {};
      const options = Array.isArray(d.sourceLocations) ? d.sourceLocations : [];
      const destinations = Array.isArray(d.destinationLocations) ? d.destinationLocations : [];
      [...options, ...destinations].forEach((item: any) => {
        if (item?.LocationID) nextMap[Number(item.LocationID)] = String(item.LocationName || '');
      });
      setLocationNames(nextMap);
    } catch (e) {
      console.error('Error loading location names', e);
    }
  }

  async function loadLotTraceability(requestList: Req[]) {
    const uniqueParts = Array.from(new Set(requestList.map((request) => String(request.PartNumber || '').trim()).filter(Boolean)));
    if (uniqueParts.length === 0) {
      setLotTraceabilityByRequest({});
      return;
    }

    try {
      const traceabilityByPart = await Promise.all(uniqueParts.map(async (partNumber) => {
        try {
          const r = await fetch(`/api/requests/lots?partNumber=${encodeURIComponent(partNumber)}&limit=50`);
          if (!r.ok) return { partNumber, lots: [] as LotTraceability[] };
          const d = await r.json();
          return { partNumber, lots: Array.isArray(d?.lots) ? d.lots : [] as LotTraceability[] };
        } catch (e) {
          console.error('Error loading lot traceability', e);
          return { partNumber, lots: [] as LotTraceability[] };
        }
      }));

      const nextMap: Record<number, LotTraceability | null> = {};
      const defaultQtyByRequest: Record<number, number> = {};
      const byPart = new Map(traceabilityByPart.map((entry) => [entry.partNumber, entry.lots]));

      requestList.forEach((request) => {
        const partNumber = String(request.PartNumber || '').trim();
        const lots = byPart.get(partNumber) || [];
        const candidate = lots.find((lot) => {
          const lotInventoryId = request.LotInventoryID != null ? String(request.LotInventoryID) : '';
          const lotReceiveId = request.LotReceiveID != null ? String(request.LotReceiveID) : '';
          const candidateInventoryId = lot.LotInventoryID != null ? String(lot.LotInventoryID) : '';
          const candidateReceiveId = lot.ReceiveID != null ? String(lot.ReceiveID) : '';
          return Boolean((lotInventoryId && candidateInventoryId && lotInventoryId === candidateInventoryId) || (lotReceiveId && candidateReceiveId && lotReceiveId === candidateReceiveId));
        }) || null;
        nextMap[request.RequestID] = candidate;
        const lotQty = candidate?.CurrentQuantity != null ? Number(candidate.CurrentQuantity) : null;
        defaultQtyByRequest[request.RequestID] = Number.isFinite(lotQty) && lotQty > 0 ? lotQty : Number(request.Quantity || 0);
      });

      setLotTraceabilityByRequest(nextMap);
      setDefaultTransferQtyByRequest(defaultQtyByRequest);
    } catch (e) {
      console.error('Error loading lot traceability', e);
      setLotTraceabilityByRequest({});
    }
  }

  async function load(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    try {
      await loadLocationNames();
      // Solo se ejecutan transferencias ya aprobadas por el ERP (estado 41) y de tipos transferibles para salidas/transferencias
      const r = await fetch('/api/requests?status=41');
      const d = await r.json();
      const nextRequests = ((d.requests || []) as Req[]).filter((req) => [2, 3, 12].includes(Number(req.RequestTypeID || 0)));
      setRequests(nextRequests);
      if (showLoading) setPage(1);
      await loadLotTraceability(nextRequests);
    } catch (e) {
      console.error(e);
    } finally { if (showLoading) { setLoading(false); } }
  }

  const isScrapOrQuarantineLocation = (locationName?: string) => {
    const value = String(locationName || '').toLowerCase();
    return [
      'quarantine',
      'quarentine',
      'purg',
      'cuarentena',
      'purgue',
    ].some((token) => value.includes(token));
  };

  const isQuarantineDestination = currentRequest?.DestinationLocationID
    ? isScrapOrQuarantineLocation(locationNames[currentRequest.DestinationLocationID] || '')
    : false;

  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
  const pagedRequests = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function execute(req: Req) {
    setCurrentRequest(req);
    setShowStorageModal(true);
    const defaultQty = defaultTransferQtyByRequest[req.RequestID] ?? Number(req.Quantity || 0);
    setQuantityInput(String(defaultQty));
  }

  const isIncomingStorageTransfer = (req: Req) => {
    if (Number(req.RequestTypeID) !== 2) return false;
    const sourceName = req.SourceLocationID ? String(locationNames[req.SourceLocationID] || '').toLowerCase() : '';
    const destinationName = req.DestinationLocationID ? String(locationNames[req.DestinationLocationID] || '').toLowerCase() : '';
    return sourceName.includes('incoming') && /stor|almac/.test(destinationName);
  };

  const getStorageLocationCode = (location: StorageLocation) => {
    const rackName = String(location?.RackName || '').trim().toUpperCase();
    const rackColumn = String(location?.RackColumn ?? 0);
    const rackCell = String(location?.RackCell ?? 0);
    return `${rackName}-${rackColumn}-${rackCell}`;
  };

  async function loadStorageLocations() {
    setLoadingStorageLocations(true);
    try {
      const response = await fetch('/api/storage-locations?limit=500');
      if (!response.ok) throw new Error('No fue posible cargar las ubicaciones de rack');
      const data = await response.json();
      setStorageLocations(Array.isArray(data.locations) ? data.locations : []);
    } catch (e) {
      setStorageLocations([]);
      alert(e instanceof Error ? e.message : 'Error cargando ubicaciones de rack');
    } finally {
      setLoadingStorageLocations(false);
    }
  }

  function handleRackCodeChange(value: string) {
    setRackCodeInput(value.toUpperCase());
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setSelectedStorageLocation(null);
      return;
    }
    const matched = storageLocations.find((loc) => getStorageLocationCode(loc) === normalized);
    if (matched) setSelectedStorageLocation(matched);
  }

  function openRackPicker(req: Req) {
    setRackRequest(req);
    setSelectedStorageLocation(null);
    setRackCodeInput('');
    setShowRackModal(true);
    void loadStorageLocations();
  }

  async function handleCompleteStorageTransfer() {
    if (!rackRequest || !selectedStorageLocation) {
      alert('Selecciona un rack de destino.');
      return;
    }

    if (!confirm(`Confirmar traslado de ${rackRequest.PartNumber} x ${rackRequest.Quantity} al rack ${getStorageLocationCode(selectedStorageLocation)}?`)) {
      return;
    }

    try {
      setCompletingRack(rackRequest.RequestID);
      const r = await fetch(`/api/requests/${rackRequest.RequestID}/complete-storage-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageId: Number(selectedStorageLocation.StorageID),
          regUserId: user?.id || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'No fue posible completar la transferencia');

      setShowRackModal(false);
      setRackRequest(null);
      notifyAppRefresh('action');
      await load(false);
      alert('Transferencia a rack completada correctamente.');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCompletingRack(null);
    }
  }

  async function executeTransferWithLocation() {
    if (!currentRequest) {
      alert('No hay solicitud seleccionada.');
      return;
    }

    const parsedQuantity = Number(quantityInput);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      alert('Ingresa la cantidad realmente transferida');
      return;
    }

    const locationLabel = currentRequest.DestinationLocationID
      ? (
          locationNames[currentRequest.DestinationLocationID] ||
          `#${currentRequest.DestinationLocationID}`
        )
      : 'Sin destino definido';

    if (
      !confirm(
        `${t('transfers.confirmExecute')}\n` +
        `${currentRequest.PartNumber} x ${parsedQuantity}\n` +
        `Destino: ${locationLabel}\n\n` +
        `Para salidas parciales, el lote se mantiene en su ubicación actual y solo se descuenta la cantidad indicada.`
      )
    ) {
      return;
    }

    try {
      setExecuting(currentRequest.RequestID);

      // Ejecuta la transferencia y confirma el movimiento en MES Web en una
      // sola operación atómica: si cualquier parte falla, el backend revierte
      // todo y la solicitud queda intacta en su estado anterior.
      const r = await fetch(
        `/api/requests/${currentRequest.RequestID}/execute-transfer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            regUserId: user?.id || null,
            quantity: parsedQuantity,
            sourceLocationId: currentRequest.SourceLocationID || null,
            destinationLocationId: currentRequest.DestinationLocationID || null,
          }),
        }
      );

      const d = await r.json();

      if (!r.ok) {
        throw new Error(
          d.message || 'Error executing transfer'
        );
      }

      setShowStorageModal(false);
      notifyAppRefresh('action');
      await load(false);

      alert('Transferencia confirmada correctamente.');

    } catch (e) {
      const message =
        e instanceof Error ? e.message : String(e);

      alert(message);
    } finally {
      setExecuting(null);
    }
  }

  return (
    <Layout title={t('transfers.title')}>
      <div className="space-y-4">
        {loading ? (
          <div>Cargando...</div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-6">
            <div className="w-40 h-40 bg-emerald-50 dark:bg-emerald-500/10 rounded-[3rem] flex items-center justify-center text-emerald-600 border-4 border-dashed border-emerald-200 dark:border-emerald-500/30">
              <Check size={80} />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">{t('transfers.title')}</h2>
            </div>
            <div className="w-full max-w-md px-4">
              <button onClick={() => void load(true)} className="w-full bg-slate-900 text-white py-5 rounded-[2rem] font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-2xl shadow-slate-900/20 active:scale-95 transition-all">
                <ArrowRight size={20} />
                <span>Recargar</span>
              </button>
            </div>
            <button onClick={() => window.location.href = '/requests'} className="text-xs text-slate-500 underline">Ir a Solicitudes</button>
          </div>
        ) : (
          pagedRequests.map((r) => (
            <div key={r.RequestID} className="w-full overflow-hidden rounded-[1.5rem] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-800/95 dark:to-slate-900/90">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      Solicitud #{r.RequestID}
                    </span>
                    <div className="break-words text-base font-black leading-snug text-slate-900 dark:text-slate-100">
                      {r.PartNumber}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 font-semibold dark:bg-slate-700/70">
                      Cantidad: {r.Quantity}
                    </span>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {r.SourceLocationID ? (
                        <span className="w-fit rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 break-words dark:bg-blue-500/10 dark:text-blue-300">
                          Origen: {locationNames[r.SourceLocationID] || `#${r.SourceLocationID}`}
                        </span>
                      ) : null}
                      {r.DestinationLocationID ? (
                        <span className="w-fit rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 break-words dark:bg-emerald-500/10 dark:text-emerald-300">
                          Destino: {locationNames[r.DestinationLocationID] || `#${r.DestinationLocationID}`}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {r.RequestName ? (
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 break-words text-xs font-medium leading-relaxed text-slate-500 dark:border-slate-700 dark:bg-slate-700/50 dark:text-slate-400">
                      {r.RequestName}
                    </div>
                  ) : null}

                  {lotTraceabilityByRequest[r.RequestID] ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-700/50 dark:text-slate-300">
                      <div className="font-black uppercase tracking-[0.2em] text-slate-400">Trazabilidad de lote</div>
                      <div className="mt-1 break-words font-semibold text-slate-800 dark:text-slate-100">
                        Lote: {lotTraceabilityByRequest[r.RequestID]?.InternalLot || lotTraceabilityByRequest[r.RequestID]?.ProviderLot || lotTraceabilityByRequest[r.RequestID]?.ShortInternalLot || `#${lotTraceabilityByRequest[r.RequestID]?.ReceiveID || lotTraceabilityByRequest[r.RequestID]?.LotInventoryID || 'n/a'}`}
                      </div>
                      <div className="mt-1 break-words">
                        Ubicación actual: {lotTraceabilityByRequest[r.RequestID]?.CurrentLocationID ? (locationNames[lotTraceabilityByRequest[r.RequestID]?.CurrentLocationID as number] || `#${lotTraceabilityByRequest[r.RequestID]?.CurrentLocationID}`) : 'Sin ubicación registrada'}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-start">
                  {Number(r.RequestStatusID) === 41 ? (
                    isIncomingStorageTransfer(r) ? (
                      <button
                        disabled={completingRack === r.RequestID}
                        onClick={() => openRackPicker(r)}
                        className="flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition-all active:scale-95 disabled:opacity-70"
                      >
                        <Box size={14} />
                        <span>Seleccionar rack</span>
                      </button>
                    ) : (
                      <button
                        disabled={executing === r.RequestID}
                        onClick={() => execute(r)}
                        className="flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition-all active:scale-95 disabled:opacity-70"
                      >
                        {executing === r.RequestID ? (
                          '...'
                        ) : (
                          <>
                            <Check size={14} />
                            <span>Empezar transferencia</span>
                          </>
                        )}
                      </button>
                    )
                  ) : null}
                  <ArrowRight size={18} className="text-slate-400" />
                </div>
              </div>
            </div>
          ))
        )}

        {!loading && requests.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <ChevronLeft size={14} />
              Anterior
            </button>
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Página {page} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Siguiente
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Modal de selección de ubicación */}
      {showStorageModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl dark:bg-slate-800"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                Seleccionar Ubicación
              </h2>
              <button
                onClick={() => setShowStorageModal(false)}
                className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X size={20} className="text-slate-600 dark:text-slate-300" />
              </button>
            </div>

            {currentRequest ? (
              <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-700/50">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Trazabilidad del movimiento</div>
                <div className="mt-1 break-words text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
                  {currentRequest.PartNumber}
                </div>
                {(() => {
                  const traceability = currentRequest ? lotTraceabilityByRequest[currentRequest.RequestID] : null;
                  return traceability ? (
                    <>
                      <div className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        Lote: {traceability.InternalLot || traceability.ProviderLot || traceability.ShortInternalLot || `#${traceability.ReceiveID || traceability.LotInventoryID || 'n/a'}`}
                      </div>
                      <div className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        Ubicación actual: {traceability.CurrentLocationID ? (locationNames[traceability.CurrentLocationID] || `#${traceability.CurrentLocationID}`) : 'Sin ubicación registrada'}
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">No hay trazabilidad de lote asociada a esta solicitud.</div>
                  );
                })()}
                <div className="mt-2 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  Destino sugerido: {currentRequest.DestinationLocationID ? (locationNames[currentRequest.DestinationLocationID] || `#${currentRequest.DestinationLocationID}`) : 'Sin destino definido'}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-500/10 dark:text-amber-100">
              Para salidas, no se requiere elegir un rack. El lote se mantiene en su ubicación actual y solo se descuenta la cantidad indicada en la solicitud.
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-1">Cantidad a descontar</label>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={quantityInput}
                readOnly
                className="w-full bg-slate-100 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 rounded-xl py-3 px-4 font-medium text-slate-900 dark:text-slate-100 cursor-not-allowed"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">Se usa la cantidad registrada en la solicitud. No cambia la ubicación del lote cuando es una salida parcial.</p>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowStorageModal(false)}
                className="flex-1 rounded-xl bg-slate-200 px-4 py-2 font-bold text-slate-900 transition-all active:scale-95 dark:bg-slate-700 dark:text-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={executeTransferWithLocation}
                disabled={executing !== null}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              >
                {executing !== null ? 'Ejecutando...' : 'Ejecutar'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Modal de selección de rack para transferencias Incoming -> Storage */}
      {showRackModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl dark:bg-slate-800"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                Seleccionar rack de destino
              </h2>
              <button
                onClick={() => setShowRackModal(false)}
                className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X size={20} className="text-slate-600 dark:text-slate-300" />
              </button>
            </div>

            {rackRequest ? (
              <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-700/50">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{rackRequest.PartNumber}</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Cantidad (lote completo): {rackRequest.Quantity}</div>
              </div>
            ) : null}

            <label className="block">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-300">Rack de destino</span>
              <input
                type="text"
                value={rackCodeInput}
                onChange={(e) => handleRackCodeChange(e.target.value)}
                placeholder="Ej.: A-01-02"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm font-black text-slate-900 dark:text-slate-100">Catálogo de ubicaciones</p>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{storageLocations.length} ubicaciones</span>
            </div>
            {loadingStorageLocations ? (
              <div className="py-8 text-center text-slate-500">Cargando ubicaciones...</div>
            ) : storageLocations.length === 0 ? (
              <div className="py-8 text-center text-slate-500">No hay ubicaciones de rack disponibles.</div>
            ) : (
              <div className="grid gap-2 max-h-72 overflow-y-auto pt-3">
                {storageLocations.map((loc) => {
                  const locationCode = getStorageLocationCode(loc);
                  const isSelected = selectedStorageLocation?.StorageID === loc.StorageID;
                  return (
                    <button
                      key={loc.StorageID}
                      type="button"
                      onClick={() => {
                        setSelectedStorageLocation(loc);
                        setRackCodeInput(locationCode);
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? 'border-blue-600 bg-blue-50 text-slate-900 dark:border-blue-400 dark:bg-blue-900/30 dark:text-white' : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100'}`}
                    >
                      <div className="font-bold">{locationCode}</div>
                      <div className="mt-1 text-sm opacity-80">
                        {loc.LocationName ? `${loc.LocationName} • ` : ''}Col {loc.RackColumn} - Cel {loc.RackCell}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowRackModal(false)}
                className="flex-1 rounded-xl bg-slate-200 px-4 py-2 font-bold text-slate-900 transition-all active:scale-95 dark:bg-slate-700 dark:text-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={handleCompleteStorageTransfer}
                disabled={completingRack !== null || !selectedStorageLocation}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              >
                {completingRack !== null ? 'Completando...' : 'Marcar como completado'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </Layout>
  );
};

export default Transfers;
