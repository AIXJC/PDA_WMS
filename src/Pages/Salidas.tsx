import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpCircle, Plus, Check, Clock, ChevronRight, RefreshCw, ScanLine, Package, Truck } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import { notifyAppRefresh } from '../utils/realtime';

type RequestItem = {
  RequestID: number;
  RequestName?: string;
  PartNumber?: string;
  Quantity?: number | string;
  RequestStatusID?: number;
  RequestTypeID?: number;
  RequestTypeName?: string;
  SourceLocationID?: number;
  DestinationLocationID?: number;
};

export const Salidas: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ PartNumber: '', Quantity: '1', Comments: '', LotReceiveID: '', LotInventoryID: '' });
  const [consumptionTypeId, setConsumptionTypeId] = useState<number | null>(null);
  const [defaultSourceLocationId, setDefaultSourceLocationId] = useState<number | null>(null);
  const [defaultDestinationLocationId, setDefaultDestinationLocationId] = useState<number | null>(null);
  const [availableRacks, setAvailableRacks] = useState<any[]>([]);
  const [selectedSourceStorageId, setSelectedSourceStorageId] = useState<number | null>(null);
  const [loadingRackInventory, setLoadingRackInventory] = useState(false);
  const [rackInventoryError, setRackInventoryError] = useState<string | null>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [lotSearchPerformed, setLotSearchPerformed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorDetails, setFormErrorDetails] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [stockMap, setStockMap] = useState<Record<number, any[]>>({});
  const [scanLotText, setScanLotText] = useState('');
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | '40' | '41' | '42' | '43'>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 10;

  useEffect(() => { void load(true); }, [statusFilter]);

  async function resolveDefaults() {
    try {
      const r = await fetch('/api/scrap/location-options');
      const d = await r.json();
      const locations = Array.isArray(d.availableLocations)
        ? d.availableLocations
        : [
            ...(Array.isArray(d.sourceLocations) ? d.sourceLocations : []),
            ...(Array.isArray(d.destinationLocations) ? d.destinationLocations : []),
          ];
      const findBy = (arr: any[], keys: string[]) => {
        const key = (s: string) => String(s || '').toLowerCase();
        for (const k of keys) {
          const found = arr.find((it) => key(it.LocationName).includes(k));
          if (found) return Number(found.LocationID);
        }
        return null;
      };
      // Defaults for Salidas: origen Storage, destino Production
      const srcId = findBy(locations, ['storage', 'almac', 'stor']);
      const destId = findBy(locations, ['production', 'produ', 'producción', 'produccion']);
      setDefaultSourceLocationId(srcId);
      setDefaultDestinationLocationId(destId);
    } catch (e) {
      // ignore
    }
  }

  async function load(reset = false, show = true) {
    if (show) setLoading(true);
    try {
      await resolveDefaults();
      // find consumption request type
      const rt = await fetch('/api/request-types');
      const rtd = await rt.json();
      const types = Array.isArray(rtd.requestTypes) ? rtd.requestTypes : [];
      const consumption = types.find((t: any) => {
        const k = String(t.RequestType || '').toLowerCase();
        return k.includes('consum') || k.includes('consumption') || k.includes('consumo');
      });
      if (!consumption) {
        setConsumptionTypeId(null);
        setRequests([]);
        return;
      }
      setConsumptionTypeId(Number(consumption.RequestTypeID));

      const currentOffset = reset ? 0 : offset;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(currentOffset));
      params.set('requestTypeId', String(consumption.RequestTypeID));
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }

      const res = await fetch(`/api/requests?${params.toString()}`);
      const d = await res.json();
      const all = Array.isArray(d.requests) ? d.requests : [];
      const filtered = all.filter((rq: any) => [40, 41, 42, 43].includes(Number(rq.RequestStatusID || 0)));

      if (reset) {
        setRequests(filtered);
      } else {
        setRequests((prev) => [...prev, ...filtered]);
      }
      setHasMore(all.length === PAGE_SIZE);
      setOffset((prev) => (reset ? all.length : prev + all.length));
    } catch (e) {
      console.error(e);
    } finally {
      if (show) setLoading(false);
    }
  }

  async function loadPartInventory(partNumber: string) {
    const normalized = String(partNumber || '').trim();
    if (!normalized) {
      setAvailableRacks([]);
      setSelectedSourceStorageId(null);
      setRackInventoryError(null);
      return;
    }

    setLoadingRackInventory(true);
    setRackInventoryError(null);
    setLotSearchPerformed(true);
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(normalized)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'No fue posible cargar el inventario por rack');
      }
      const locations = Array.isArray(data.locations) ? data.locations : [];
      setAvailableRacks(locations);
      if (locations.length === 1) {
        setSelectedSourceStorageId(Number(locations[0].StorageID));
      } else if (locations.length > 0 && !locations.some((l: any) => Number(l.StorageID) === selectedSourceStorageId)) {
        setSelectedSourceStorageId(null);
      }
      // load lots for this part and keep only those currently in Storage (backend sets inStorage)
      try {
        setLoadingLots(true);
        const lr = await fetch(`/api/requests/lots?partNumber=${encodeURIComponent(normalized)}&limit=50`);
        const ld = await lr.json();
        const allLots = Array.isArray(ld.lots) ? ld.lots : [];
        setLots(allLots.filter((l: any) => !!l.inStorage));
      } catch (e) {
        setLots([]);
      } finally {
        setLoadingLots(false);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setRackInventoryError(msg);
      setAvailableRacks([]);
      setSelectedSourceStorageId(null);
      setLots([]);
    } finally {
      setLoadingRackInventory(false);
    }
  }

  const openOutboundBridge = (lot: any) => {
    if (!lot?.LotInventoryID) return;
    const params = new URLSearchParams({
      from: 'outbound',
      lotInventoryId: String(lot.LotInventoryID),
      lotReference: String(lot.CurrentInternalLot || lot.InternalLot || lot.ProviderLot || lot.LotReceiveID || lot.ReceiveID || ''),
    });
    navigate(`/requests?${params.toString()}`);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consumptionTypeId) return alert('Tipo de salida (consumible) no encontrado');
    setFormError(null);
    const part = form.PartNumber.trim();
    const qty = Number(form.Quantity);
    if (!part || !Number.isFinite(qty) || qty <= 0) return alert('Ingresa producto y cantidad válida');
    if (availableRacks.length > 0 && !selectedSourceStorageId && !form.LotReceiveID) {
      return alert('Selecciona la ubicación de origen (rack) para el producto antes de crear la orden.');
    }
    setSubmitting(true);
    try {
      const payload: any = {
        RequestTypeID: consumptionTypeId,
        PartNumber: part,
        Quantity: qty,
        RegUserID: user?.id ? Number(user.id) : undefined,
        Comments: form.Comments || undefined,
      };
      // Always include LotReceiveID when user selected a lot, even if a specific rack was chosen
      if (form.LotReceiveID) payload.LotReceiveID = Number(form.LotReceiveID);
      if (form.LotInventoryID) payload.LotInventoryID = Number(form.LotInventoryID);

      if (selectedSourceStorageId) {
        const selectedRack = availableRacks.find((rack) => Number(rack.StorageID) === selectedSourceStorageId);
        // Use plant LocationID when available (backend expects a PLANT_LOCATIONS.LocationID)
        payload.SourceLocationID = selectedRack ? Number(selectedRack.LocationID || selectedRack.StorageID) : Number(selectedSourceStorageId);
      } else if (form.LotReceiveID) {
        // Prefer automatic Storage lookup when a LotReceiveID is provided
        const lotIdStr = String(form.LotReceiveID);
        const selectedLot = lots.find((l: any) => String(l.ReceiveID || l.LotReceiveID) === lotIdStr || String(l.LotInventoryID) === lotIdStr);
        if (selectedLot) {
          // If backend provided a PLANT LocationID on the lot, prefer it. Otherwise try to map via StorageID -> LocationID from availableRacks.
          if (selectedLot.CurrentLocationID) {
            payload.SourceLocationID = Number(selectedLot.CurrentLocationID);
          } else if (selectedLot.LocationID) {
            payload.SourceLocationID = Number(selectedLot.LocationID);
          } else if (selectedLot.StorageID) {
            const matchingRack = availableRacks.find((r: any) => Number(r.StorageID) === Number(selectedLot.StorageID));
            if (matchingRack && matchingRack.LocationID) payload.SourceLocationID = Number(matchingRack.LocationID);
            else payload.SourceLocationID = Number(selectedLot.StorageID);
          } else if (defaultSourceLocationId) {
            payload.SourceLocationID = defaultSourceLocationId;
          }
        } else if (defaultSourceLocationId) {
          payload.SourceLocationID = defaultSourceLocationId;
        }
        // (LotReceiveID already assigned above)
      } else if (defaultSourceLocationId) {
        payload.SourceLocationID = defaultSourceLocationId;
      }
      if (defaultDestinationLocationId) payload.DestinationLocationID = defaultDestinationLocationId;

      const r = await fetch('/api/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok) {
        const msg = d?.message || 'No se pudo crear la orden de salida';
        setFormError(msg);
        setFormErrorDetails({ availableRacks: d?.availableRacks || null, lotsInStorage: d?.lotsInStorage || null, selectedSourceLocationId: d?.selectedSourceLocationId || null });
        throw new Error(msg);
      }
      setForm({ PartNumber: '', Quantity: '1', Comments: '', LotReceiveID: '', LotInventoryID: '' });
      setShowCreate(false);
      notifyAppRefresh('action');
      await load(false);
      alert(`Orden de salida creada #${d.requestId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg);
    } finally { setSubmitting(false); }
  }

  function handleLotChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setForm((p) => ({ ...p, LotReceiveID: val, LotInventoryID: '' }));
    if (!val) {
      setSelectedSourceStorageId(null);
      return;
    }
    const lotIdStr = String(val);
    const selectedLot = lots.find((l: any) => String(l.ReceiveID || l.LotReceiveID) === lotIdStr || String(l.LotInventoryID) === lotIdStr);
    if (selectedLot) {
      setForm((p) => ({ ...p, LotInventoryID: selectedLot.LotInventoryID ? String(selectedLot.LotInventoryID) : '' }));
      if (selectedLot.CurrentLocationID) {
        const matchedRack = availableRacks.find((r: any) => Number(r.LocationID) === Number(selectedLot.CurrentLocationID) || Number(r.StorageID) === Number(selectedLot.CurrentLocationID));
        if (matchedRack) {
          setSelectedSourceStorageId(Number(matchedRack.StorageID));
          openOutboundBridge(selectedLot);
          return;
        }
      }
      if (selectedLot.StorageID) {
        setSelectedSourceStorageId(Number(selectedLot.StorageID));
        openOutboundBridge(selectedLot);
      } else if (selectedLot.LocationID) {
        // if lot includes a PLANT LocationID, leave storage null but keep location defaulting on submit
        setSelectedSourceStorageId(null);
        openOutboundBridge(selectedLot);
      } else {
        setSelectedSourceStorageId(null);
      }
    }
  }

  const groups = [40,41,42,43].map((id) => ({ id, title: id === 40 ? 'Pendientes' : id === 41 ? 'Aprobadas' : id === 42 ? 'Ejecutadas' : 'Cerradas' }));
  const filterOptions = [
    { value: 'all', label: 'Todos' },
    { value: '40', label: 'Pendientes' },
    { value: '41', label: 'Aprobadas' },
    { value: '42', label: 'Ejecutadas' },
    { value: '43', label: 'Cerradas' },
  ] as const;
  const visibleRequests = statusFilter === 'all' ? requests : requests.filter((req) => Number(req.RequestStatusID || 0) === Number(statusFilter));

  const getStatusGroup = (statusId: number) => groups.find((group) => group.id === statusId) ?? { id: statusId, title: 'Desconocido' };
  const getStatusBadgeClass = (statusId: number) => {
    if (statusId === 41) return 'bg-emerald-100 text-emerald-700';
    if (statusId === 40) return 'bg-amber-100 text-amber-700';
    if (statusId === 42) return 'bg-slate-100 text-slate-700';
    return 'bg-slate-200 text-slate-700';
  };

  return (
    <Layout title="Salidas">
      <AnimatePresence mode="wait">
        {showCreate ? (
          <motion.div
            key="create"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="rounded-[2.2rem] border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-4 shadow-sm dark:border-slate-700 dark:from-slate-800/90 dark:to-slate-900">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">Crear Orden de Salida</h2>
                  <p className="text-sm text-slate-500">Crear una orden de salida para consumibles (origen: Storage, destino: Production).</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError ? <p className="text-sm text-red-500">{formError}</p> : null}
              {formErrorDetails && (formErrorDetails.availableRacks || formErrorDetails.lotsInStorage) ? (
                <div className="mt-2 space-y-2">
                  {formErrorDetails.availableRacks && formErrorDetails.availableRacks.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <div className="font-black text-slate-700">Racks con stock del producto</div>
                      <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
                        {formErrorDetails.availableRacks.map((r: any) => (
                          <li key={r.StorageID}>Rack {r.RackName || r.StorageID} · {r.LocationName || ''} — {Number(r.Quantity || 0)} un.</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {formErrorDetails.lotsInStorage && formErrorDetails.lotsInStorage.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <div className="font-black text-slate-700">Lotes existentes para este producto</div>
                      <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
                        {formErrorDetails.lotsInStorage.map((l: any) => (
                          <li key={l.ReceiveID}>{l.InternalLot || l.ProviderLot || `Lote ${l.ReceiveID}`}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 uppercase ml-2">Producto</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={form.PartNumber}
                    onChange={(e) => setForm((p) => ({ ...p, PartNumber: e.target.value.toUpperCase() }))}
                    className="min-w-0 flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => void loadPartInventory(form.PartNumber)}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition-all active:scale-95"
                  >
                    Cargar stock
                  </button>
                </div>
                {loadingRackInventory ? (
                  <p className="text-sm text-slate-500">Cargando ubicaciones...</p>
                ) : rackInventoryError ? (
                  <p className="text-sm text-red-500">{rackInventoryError}</p>
                ) : availableRacks.length > 0 ? (
                  <>
                  <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/90">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-black uppercase text-slate-500">Ubicaciones disponibles</span>
                      <span className="text-slate-600 dark:text-slate-300">Total: {availableRacks.reduce((sum, rack) => sum + Number(rack.Quantity || 0), 0)} un.</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {availableRacks.map((rack) => (
                        <label
                          key={rack.StorageID}
                          className={`cursor-pointer rounded-2xl border p-3 transition-all ${selectedSourceStorageId === Number(rack.StorageID) ? 'border-blue-500 bg-blue-500/10' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/70'}`}
                        >
                          <input
                            type="radio"
                            name="sourceLocation"
                            value={rack.StorageID}
                            checked={selectedSourceStorageId === Number(rack.StorageID)}
                            onChange={() => setSelectedSourceStorageId(Number(rack.StorageID))}
                            className="mr-2"
                          />
                          <div className="font-black text-slate-900 dark:text-slate-100">{rack.RackName || `Rack ${rack.StorageID}`}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{rack.LocationName ? `${rack.LocationName} · ` : ''}Col {rack.RackColumn} · Cel {rack.RackCell}</div>
                          <div className="mt-2 text-sm font-black text-slate-700 dark:text-slate-200">{Number(rack.Quantity || 0)} un.</div>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Selecciona la ubicación de origen desde donde saldrán los consumibles. La resta se hará al ejecutar la transferencia en el módulo de Transferencias.</p>
                  </div>
                  
                  </>
                ) : form.PartNumber.trim() ? (
                  <p className="text-sm text-slate-500">No se encontró stock en racks para este producto; se usará la ubicación genérica de Storage.</p>
                ) : null}
              </div>

              {/* Lote selector independiente: mostrado cuando hay lotes (o cuando están cargando) */}
              {loadingLots ? (
                <p className="text-sm text-slate-500 mt-2">Cargando lotes en Storage...</p>
              ) : lots.length > 0 ? (
                <div className="space-y-2 mt-4">
                  <label className="text-xs font-black text-slate-500 uppercase ml-2">Lote (solo Storage)</label>
                  <select
                    value={form.LotReceiveID}
                    onChange={handleLotChange}
                    className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Selecciona un lote (Storage)</option>
                    {lots.map((lot) => {
                      const lotLabel = lot.InternalLot || lot.ShortInternalLot || lot.ProviderLot || `Lote ${lot.ReceiveID}`;
                      return (
                        <option key={lot.ReceiveID} value={lot.ReceiveID}>{lotLabel} {lot.PartNumber ? `- ${lot.PartNumber}` : ''}</option>
                      );
                    })}
                  </select>
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">Solo se muestran lotes que tienen stock en Storage.</p>
                </div>
              ) : lotSearchPerformed && form.PartNumber.trim() ? (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/30 dark:bg-amber-950/20 dark:text-amber-200 mt-4">
                  No se encontraron lotes en Storage para este producto. Si no seleccionas lote, la orden se creará sin lote.
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 uppercase ml-2">Cantidad</label>
                <input
                  type="number"
                  min="1"
                  value={form.Quantity}
                  onChange={(e) => setForm((p) => ({ ...p, Quantity: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 uppercase ml-2">Comentarios</label>
                <textarea
                  value={form.Comments}
                  onChange={(e) => setForm((p) => ({ ...p, Comments: e.target.value }))}
                  rows={4}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium resize-none text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  <span>{submitting ? 'Guardando...' : 'Crear Orden'}</span>
                  <Check size={18} />
                </button>
              </div>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-4"
          >
            <div className="rounded-[2.2rem] border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-4 shadow-sm dark:border-slate-700 dark:from-slate-800/90 dark:to-slate-900">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-[1.3rem] bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                      <ArrowUpCircle size={26} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Salidas</p>
                      <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">Gestión de salidas</h2>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void load(true)} className="rounded-[1.2rem] border border-slate-200 bg-white p-3 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-200">
                      <RefreshCw size={16} />
                    </button>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
                  <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-slate-500">
                    <ScanLine size={16} />
                    <span>Escaneo de lote</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <input
                      placeholder="Escanea o ingresa referencia de lote"
                      value={scanLotText}
                      onChange={(e) => setScanLotText(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-3 px-3 focus:border-blue-500 outline-none transition-all"
                    />
                    <button
                      onClick={async () => {
                        const ref = String(scanLotText || '').trim();
                        if (!ref) return alert('Ingresa referencia de lote');
                        try {
                          const r = await fetch(`/api/requests/lots?lotReference=${encodeURIComponent(ref)}&limit=20`);
                          const d = await r.json();
                          const lots = Array.isArray(d.lots) ? d.lots : [];
                          if (lots.length === 0) {
                            alert('No se encontró lote en Storage con esa referencia');
                            setScanResults([]);
                            return;
                          }
                          if (lots.length === 1) {
                            openOutboundBridge(lots[0]);
                            setScanResults([]);
                            setScanLotText('');
                            return;
                          }
                          setScanResults(lots);
                        } catch (e) {
                          alert('Error buscando lote');
                        }
                      }}
                      className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
                    >
                      Crear Orden de Consumo
                    </button>
                  </div>
                  {scanResults.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {scanResults.map((lot) => (
                        <button key={lot.LotInventoryID} onClick={() => openOutboundBridge(lot)} className="text-left rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                          <div className="flex items-center gap-2">
                            <Package size={14} />
                            <span>{lot.CurrentInternalLot || lot.InternalLot || `Lote ${lot.ReceiveID}`}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {lot.PartNumber || 'Sin producto'} • {Number(lot.CurrentQuantity || 0)} un.
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-300">Solicitudes de salida</p>
                  <h3 className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">Resumen visual por estatus</h3>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Revisa las órdenes con una estructura más limpia y alineada.</p>
                </div>
                <div className="rounded-2xl bg-blue-50 px-3 py-2 text-right dark:bg-blue-500/10">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-600 dark:text-blue-300">Total</p>
                  <p className="text-sm font-black text-slate-900 dark:text-slate-100">{requests.length}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 rounded-[1.4rem] border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/80">
                {filterOptions.map((filter) => {
                  const isActive = statusFilter === filter.value;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setStatusFilter(filter.value as 'all' | '40' | '41' | '42' | '43')}
                      className={`rounded-[1rem] px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition-all ${isActive ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {loading ? (
              <div className="rounded-[2rem] border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/95">Cargando salidas...</div>
            ) : statusFilter === 'all' ? (
              <div className="space-y-3">
                {visibleRequests.length === 0 ? (
                  <div className="rounded-[2rem] border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/95">No hay órdenes de salida.</div>
                ) : (
                  <div className="space-y-3">
                    {visibleRequests.map((req) => {
                      const statusId = Number(req.RequestStatusID || 0);
                      const statusGroup = getStatusGroup(statusId);
                      const badgeClass = getStatusBadgeClass(statusId);
                      return (
                        <div key={req.RequestID} className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{req.PartNumber || req.RequestName || 'Salida'}</h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">Orden #{req.RequestID}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${badgeClass}`}>
                              {statusGroup.title}
                            </span>
                          </div>

                          <div className="flex flex-col gap-3 rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                              <p>Origen: {req.SourceLocationID ? `ID ${req.SourceLocationID}` : 'Sin ubicación'}</p>
                              <p className="mt-1">Destino: {req.DestinationLocationID ? `ID ${req.DestinationLocationID}` : 'Producción'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {Number(req.RequestStatusID) === 41 && (
                                <button onClick={() => window.location.href = `/transfers?requestId=${req.RequestID}`} className="flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-black text-white shadow-sm transition-all active:scale-95">
                                  <span>Transferir</span>
                                  <ChevronRight size={16} />
                                </button>
                              )}
                              <button
                                onClick={async () => {
                                  const id = Number(req.RequestID);
                                  const part = String(req.PartNumber || '').trim();
                                  setExpanded((s) => ({ ...s, [id]: !s[id] }));
                                  if (!stockMap[id] && part) {
                                    try {
                                      const r = await fetch(`/api/inventory/${encodeURIComponent(part)}`);
                                      const d = await r.json();
                                      const locs = Array.isArray(d.locations) ? d.locations : [];
                                      setStockMap((s) => ({ ...s, [id]: locs }));
                                    } catch (e) {
                                      setStockMap((s) => ({ ...s, [id]: [] }));
                                    }
                                  }
                                }}
                                className="rounded-2xl border border-slate-200 bg-slate-950/5 px-3 py-2 text-sm font-black text-slate-900 dark:border-slate-700 dark:bg-slate-700 dark:text-white"
                              >
                                Ver ubicaciones
                              </button>
                            </div>
                          </div>

                          {expanded[req.RequestID] && (
                            <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-slate-950/90 p-4 text-slate-100 shadow-sm dark:border-slate-700">
                              <h5 className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Ubicaciones y stock</h5>
                              <div className="mt-2 space-y-2">
                                {(stockMap[req.RequestID] || []).length === 0 ? (
                                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-sm text-slate-400">No hay registros de inventario para este producto.</div>
                                ) : (
                                  (stockMap[req.RequestID] || []).map((loc) => (
                                    <div key={loc.InventoryID} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                                      <div className="text-sm">
                                        <div className="font-black text-slate-100">{loc.RackName || `Rack ${loc.StorageID}`}</div>
                                        <div className="text-xs text-slate-500">{loc.LocationName ? `${loc.LocationName} · ` : ''}{loc.RackColumn ? `Col ${loc.RackColumn}` : ''}{loc.RackCell ? ` Cel ${loc.RackCell}` : ''}</div>
                                      </div>
                                      <div className="text-sm font-black text-slate-100">{loc.Quantity ?? 0} un.</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {groups.filter((group) => String(group.id) === statusFilter).map((group) => {
                  const items = visibleRequests.filter((req) => Number(req.RequestStatusID || 0) === group.id);
                  const shouldShowEmptyState = items.length === 0;
                  return (
                    <div key={group.id} className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{group.title}</h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{items.length} orden{items.length === 1 ? '' : 'es'}</p>
                        </div>
                        <div className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${group.id === 41 ? 'bg-emerald-100 text-emerald-700' : group.id === 40 ? 'bg-amber-100 text-amber-700' : group.id === 42 ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 text-slate-700'}`}>
                          {group.title}
                        </div>
                      </div>

                      {shouldShowEmptyState ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Sin órdenes en este estatus.</div>
                      ) : (
                        <div className="space-y-2">
                          {items.map((req) => (
                            <div key={req.RequestID} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-100">
                                      <Truck size={18} />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Orden #{req.RequestID}</p>
                                      <h4 className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{req.PartNumber || req.RequestName || 'Salida'}</h4>
                                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
                                        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm dark:bg-slate-700">{req.PartNumber || 'Sin producto'}</span>
                                        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm dark:bg-slate-700">{Number.isFinite(Number(req.Quantity)) ? `${Number(req.Quantity)} unid.` : 'Sin cantidad'}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${group.id === 41 ? 'bg-emerald-100 text-emerald-700' : group.id === 40 ? 'bg-amber-100 text-amber-700' : group.id === 42 ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 text-slate-700'}`}>
                                  {group.title}
                                </span>
                              </div>

                              <div className="mt-4 flex flex-col gap-3 rounded-[1.2rem] border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                  <p>Origen: {req.SourceLocationID ? `ID ${req.SourceLocationID}` : 'Sin ubicación'}</p>
                                  <p className="mt-1">Destino: {req.DestinationLocationID ? `ID ${req.DestinationLocationID}` : 'Producción'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {Number(req.RequestStatusID) === 41 && (
                                    <button onClick={() => window.location.href = `/transfers?requestId=${req.RequestID}`} className="flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-black text-white shadow-sm transition-all active:scale-95">
                                      <span>Transferir</span>
                                      <ChevronRight size={16} />
                                    </button>
                                  )}
                                  <button
                                    onClick={async () => {
                                      const id = Number(req.RequestID);
                                      const part = String(req.PartNumber || '').trim();
                                      setExpanded((s) => ({ ...s, [id]: !s[id] }));
                                      if (!stockMap[id] && part) {
                                        try {
                                          const r = await fetch(`/api/inventory/${encodeURIComponent(part)}`);
                                          const d = await r.json();
                                          const locs = Array.isArray(d.locations) ? d.locations : [];
                                          setStockMap((s) => ({ ...s, [id]: locs }));
                                        } catch (e) {
                                          setStockMap((s) => ({ ...s, [id]: [] }));
                                        }
                                      }
                                    }}
                                    className="rounded-2xl border border-slate-200 bg-slate-950/5 px-3 py-2 text-sm font-black text-slate-900 dark:border-slate-700 dark:bg-slate-700 dark:text-white"
                                  >
                                    Ver ubicaciones
                                  </button>
                                </div>
                              </div>

                              {expanded[req.RequestID] && (
                                <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-slate-950/90 p-4 text-slate-100 shadow-sm dark:border-slate-700">
                                  <h5 className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Ubicaciones y stock</h5>
                                  <div className="mt-2 space-y-2">
                                    {(stockMap[req.RequestID] || []).length === 0 ? (
                                      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-sm text-slate-400">No hay registros de inventario para este producto.</div>
                                    ) : (
                                      (stockMap[req.RequestID] || []).map((loc) => (
                                        <div key={loc.InventoryID} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                                          <div className="text-sm">
                                            <div className="font-black text-slate-100">{loc.RackName || `Rack ${loc.StorageID}`}</div>
                                            <div className="text-xs text-slate-500">{loc.LocationName ? `${loc.LocationName} · ` : ''}{loc.RackColumn ? `Col ${loc.RackColumn}` : ''}{loc.RackCell ? ` Cel ${loc.RackCell}` : ''}</div>
                                          </div>
                                          <div className="text-sm font-black text-slate-100">{loc.Quantity ?? 0} un.</div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {hasMore && !loading && (
              <div className="flex justify-center pt-4">
                <button
                  type="button"
                  onClick={() => void load(false)}
                  className="rounded-full bg-blue-600 px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700"
                >
                  Cargar más
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
};

export default Salidas;
