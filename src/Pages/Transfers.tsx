import React, { useEffect, useState } from 'react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { Check, ArrowRight, X } from 'lucide-react';
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
};

type StorageLocation = {
  storageId: number;
  rackName: string;
  rackColumn: string;
  rackCell: string;
  availableCapacity: number;
  locationId?: number;
  source?: string;
  locationCode?: string;
  area?: string;
  rack?: string;
  level?: number | string;
  position?: number | string;
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
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [selectedStorageLocation, setSelectedStorageLocation] = useState<StorageLocation | null>(null);
  const [currentRequest, setCurrentRequest] = useState<Req | null>(null);

  useEffect(() => { void load(); }, []);

  useAppRefresh(() => {
    void load(false);
  }, 10000);

  useEffect(() => {
    const requestId = Number(new URLSearchParams(location.search).get('requestId'));
    if (!requestId || loading || requests.length === 0 || showStorageModal) return;

    const matchedRequest = requests.find((item) => Number(item.RequestID) === requestId);
    if (matchedRequest) {
      void execute(matchedRequest);
    }
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

  async function loadStorageLocations(partNumber: string, quantity: number) {
    setLoadingStorage(true);
    try {
      const url = `/api/storage-locations/available?partNumber=${encodeURIComponent(partNumber)}&quantity=${quantity}`;
      const r = await fetch(url);
      const d = await r.json();
      if (r.ok) {
        const nextLocations = Array.isArray(d?.storageLocations)
          ? d.storageLocations
          : Array.isArray(d?.locations)
            ? d.locations
            : [];
        setStorageLocations(nextLocations);
      } else {
        alert('Error cargando ubicaciones: ' + (d.message || 'Unknown error'));
        setStorageLocations([]);
      }
    } catch (e) {
      console.error('Error loading storage locations', e);
      setStorageLocations([]);
    } finally {
      setLoadingStorage(false);
    }
  }

  async function load(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    try {
      await loadLocationNames();
      // Cargar solicitudes en estado Aprobado (41) o Pendiente (40)
      const r = await fetch('/api/requests?status=41');
      const d = await r.json();
      const approved = d.requests || [];
      
      // También cargar pendientes si aplica
      const rPending = await fetch('/api/requests?status=40');
      const dPending = await rPending.json();
      const pending = dPending.requests || [];
      
      // Combinar ambas listas
      setRequests([...approved, ...pending]);
    } catch (e) {
      console.error(e);
    } finally { if (showLoading) { setLoading(false); } }
  }

  async function execute(req: Req) {
    // Primero mostrar el modal para seleccionar ubicación
    setCurrentRequest(req);
    setShowStorageModal(true);
    setSelectedStorageLocation(null);
    await loadStorageLocations(req.PartNumber, req.Quantity);
  }

  async function executeTransferWithLocation() {
    if (!currentRequest || !selectedStorageLocation) {
      alert('Debes seleccionar una ubicación');
      return;
    }

    if (!confirm(`${t('transfers.confirmExecute')}\n${currentRequest.PartNumber} x ${currentRequest.Quantity}\nUbicación: ${selectedStorageLocation.rackName}`)) return;
    
    try {
      setExecuting(currentRequest.RequestID);
      const body = { 
        regUserId: user?.id || null, 
        force: true,
        destinationStorageId: selectedStorageLocation.storageId
      };
      const r = await fetch(`/api/requests/${currentRequest.RequestID}/execute-transfer`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body) 
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Error executing transfer');
      alert(`OK: movement ${d.movementId}`);
      setShowStorageModal(false);
      notifyAppRefresh('action');
      await load(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
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
          requests.map((r) => (
            <div key={r.RequestID} className="w-full rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      Solicitud #{r.RequestID}
                    </span>
                  </div>
                  <div className="mt-2 text-base font-black text-slate-900 dark:text-slate-100">
                    {r.PartNumber}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-700/70">
                      Cantidad: {r.Quantity}
                    </span>
                    {r.SourceLocationID ? (
                      <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                        Origen: {locationNames[r.SourceLocationID] || `#${r.SourceLocationID}`}
                      </span>
                    ) : null}
                    {r.DestinationLocationID ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        Destino: {locationNames[r.DestinationLocationID] || `#${r.DestinationLocationID}`}
                      </span>
                    ) : null}
                  </div>
                  {r.RequestName ? (
                    <div className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                      {r.RequestName}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
                  <ArrowRight size={18} className="text-slate-400" />
                </div>
              </div>
            </div>
          ))
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
            className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl dark:bg-slate-800"
          >
            <div className="flex items-center justify-between mb-4">
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

            {loadingStorage ? (
              <div className="py-8 text-center text-slate-500">Cargando ubicaciones...</div>
            ) : storageLocations.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                No hay ubicaciones disponibles para este producto
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {storageLocations.map((loc) => (
                  <button
                    key={loc.storageId}
                    onClick={() => setSelectedStorageLocation(loc)}
                    className={`w-full rounded-xl p-3 text-left transition-all ${
                      selectedStorageLocation?.storageId === loc.storageId
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'bg-slate-50 text-slate-900 border border-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600'
                    }`}
                  >
                    <div className="font-bold">
                      {loc.locationCode || loc.rackName || `Rack ${loc.storageId}`}
                    </div>
                    <div className="text-sm opacity-75">
                      {loc.area ? `${loc.area} • ` : ''}
                      {loc.rack || loc.rackName || 'Rack'}
                      {loc.level !== undefined || loc.position !== undefined ? ` • Level ${loc.level ?? '-'} / Pos ${loc.position ?? '-'}` : ''}
                      {!loc.area && !loc.rack && !loc.level && !loc.position ? `${loc.rackColumn} - ${loc.rackCell}` : ''}
                    </div>
                    <div className="text-xs opacity-75">
                      Capacidad: {loc.availableCapacity}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowStorageModal(false)}
                className="flex-1 rounded-xl bg-slate-200 px-4 py-2 font-bold text-slate-900 transition-all active:scale-95 dark:bg-slate-700 dark:text-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={executeTransferWithLocation}
                disabled={!selectedStorageLocation || executing !== null}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              >
                {executing !== null ? 'Ejecutando...' : 'Ejecutar'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </Layout>
  );
};

export default Transfers;
