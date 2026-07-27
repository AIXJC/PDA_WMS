import React, { useEffect, useState } from 'react';
import { FileText, Plus, Check, X, Clock, ChevronRight, User, RefreshCw } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import { notifyAppRefresh, useAppRefresh } from '../utils/realtime';

type RequestItem = {
  RequestID: number;
  RequestName?: string;
  PartNumber?: string;
  Quantity?: number | string;
  RequestStatusID?: number;
  RequestTypeName?: string;
  RequestTypeDescription?: string;
  SourceLocationID?: number;
  DestinationLocationID?: number;
  RegDate?: string;
  SubmitDate?: string;
  RegUserID?: number;
};

type InventoryOption = {
  inventoryId: number;
  sku: string;
  name: string;
  stock: number | string;
  locationName?: string;
  unitType?: string;
};

type RequestFormState = {
  RequestName: string;
  PartNumber: string;
  Quantity: string;
  Comments: string;
  RequestTypeID: string;
  SourceLocationID: string;
  DestinationLocationID: string;
  LotReceiveID: string;
};

type RequestTypeOption = {
  RequestTypeID: number;
  RequestType: string;
  RequestDescription?: string;
};

type LocationMap = Record<number, string>;

export const Requests: React.FC = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locationNames, setLocationNames] = useState<LocationMap>({});
  const [requestTypes, setRequestTypes] = useState<RequestTypeOption[]>([]);
  const [sourceLocations, setSourceLocations] = useState<Array<{LocationID:number; LocationName:string}>>([]);
  const [destinationLocations, setDestinationLocations] = useState<Array<{LocationID:number; LocationName:string}>>([]);
  const [destinationOptionsBySource, setDestinationOptionsBySource] = useState<Record<string, Array<{LocationID:number; LocationName:string}>>>({});
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventoryOption | null>(null);
  const [lots, setLots] = useState<Array<{ReceiveID:number; ProviderLot?:string; InternalLot?:string; ShortInternalLot?:string; PartNumber?:string}>>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | '40' | '41' | '42'>('all');
  const [form, setForm] = useState<RequestFormState>({
    RequestName: '',
    PartNumber: '',
    Quantity: '1',
    Comments: '',
    RequestTypeID: '2',
    SourceLocationID: '',
    DestinationLocationID: '',
    LotReceiveID: '',
  });
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    void loadRequests();
  }, []);

  useAppRefresh(() => {
    void loadRequests(false);
  }, 10000);

  async function loadLocationNames() {
    try {
      const r = await fetch('/api/scrap/location-options');
      const d = await r.json();
      const nextMap: LocationMap = {};
      const sourceLocations = Array.isArray(d.sourceLocations) ? d.sourceLocations : [];
      const destinationLocations = Array.isArray(d.destinationLocations) ? d.destinationLocations : [];
      const nextDestinationOptionsBySource = d.destinationOptionsBySource && typeof d.destinationOptionsBySource === 'object'
        ? Object.entries(d.destinationOptionsBySource).reduce((acc, [key, value]) => {
            acc[key] = Array.isArray(value) ? value : [];
            return acc;
          }, {} as Record<string, Array<{LocationID:number; LocationName:string}>>)
        : {};
      [...sourceLocations, ...destinationLocations].forEach((item: any) => {
        if (item?.LocationID) nextMap[Number(item.LocationID)] = String(item.LocationName || '');
      });
      setLocationNames(nextMap);
      setSourceLocations(sourceLocations);
      setDestinationLocations(destinationLocations);
      setDestinationOptionsBySource(nextDestinationOptionsBySource);
    } catch (e) {
      console.error('Error loading location names', e);
    }
  }

  async function loadRequestTypes() {
    try {
      const r = await fetch('/api/request-types');
      const d = await r.json();
      const allTypes = Array.isArray(d.requestTypes) ? d.requestTypes : [];
      const isConsumption = (label?: string) => {
        if (!label) return false;
        const key = String(label).toLowerCase();
        return key.includes('consum') || key.includes('consumption') || key.includes('consumo');
      };
      // Exclude consumption-type from the general Requests create/select UI
      setRequestTypes(allTypes.filter((t: any) => !isConsumption(t.RequestType)));
    } catch (e) {
      console.error('Error loading request types', e);
    }
  }

  async function loadLots() {
    try {
      const r = await fetch('/api/requests/lots?limit=50');
      const d = await r.json();
      setLots(Array.isArray(d.lots) ? d.lots : []);
    } catch (e) {
      console.error('Error loading lots', e);
      setLots([]);
    }
  }

  async function loadInventoryOptions() {
    try {
      const r = await fetch('/api/inventory?limit=500');
      const d = await r.json();
      const nextOptions = Array.isArray(d.inventory) ? d.inventory : [];
      setInventoryOptions(nextOptions);

      if (form.PartNumber.trim()) {
        const matched = nextOptions.find((item: InventoryOption) => String(item.sku || '').toUpperCase() === form.PartNumber.trim().toUpperCase());
        setSelectedInventoryItem(matched || null);
      }
    } catch (e) {
      console.error('Error loading inventory options', e);
      setInventoryOptions([]);
      setSelectedInventoryItem(null);
    }
  }

  async function loadRequests(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    try {
      await Promise.all([loadLocationNames(), loadRequestTypes(), loadLots(), loadInventoryOptions()]);
      const r = await fetch('/api/requests?limit=100');
      const d = await r.json();
      const all = Array.isArray(d.requests) ? d.requests : [];
      const isConsumption = (label?: string) => {
        if (!label) return false;
        const key = String(label).toLowerCase();
        return key.includes('consum') || key.includes('consumption') || key.includes('consumo');
      };
      // Remove requests that are handled by the Salidas (consumption) module
      setRequests(all.filter((req: any) => !isConsumption(req.RequestTypeName || req.RequestTypeDescription)));
    } catch (e) {
      console.error(e);
      if (showLoading) {
        setRequests([]);
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedPartNumber = form.PartNumber.trim();
    const normalizedQty = Number(form.Quantity);

    if (!normalizedPartNumber || !Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      alert('Ingresa un producto y una cantidad válida');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        RequestTypeID: Number(form.RequestTypeID) || 2,
        RequestStatusID: 40,
        PartNumber: normalizedPartNumber,
        Quantity: normalizedQty,
        RegUserID: user?.id ? Number(user.id) : undefined,
        Comments: form.Comments.trim() || undefined,
        SourceLocationID: form.SourceLocationID ? Number(form.SourceLocationID) : undefined,
        DestinationLocationID: form.DestinationLocationID ? Number(form.DestinationLocationID) : undefined,
        LotReceiveID: form.RequestTypeID === '6' && form.LotReceiveID ? Number(form.LotReceiveID) : undefined,
      };

      const r = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'No se pudo crear la solicitud');

      setForm({ RequestName: '', PartNumber: '', Quantity: '1', Comments: '', RequestTypeID: '2', SourceLocationID: '', DestinationLocationID: '', LotReceiveID: '' });
      setSelectedInventoryItem(null);
      setShowCreate(false);
      await loadRequests(false);
      notifyAppRefresh('action');
      alert(`Solicitud creada correctamente #${d.requestId}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      alert(message);
    } finally {
      setSubmitting(false);
    }
  }

  const availableStock = selectedInventoryItem ? Number(selectedInventoryItem.stock || 0) : null;
  const maxAllowedQuantity = availableStock && Number.isFinite(availableStock) ? Math.max(1, availableStock) : undefined;
  const visibleGroups = statusFilter === 'all'
    ? [
        { id: 40, title: 'Pendientes', accent: 'amber' as const },
        { id: 41, title: 'Aprobadas', accent: 'emerald' as const },
        { id: 42, title: 'Ejecutadas', accent: 'slate' as const },
      ]
    : [{ id: Number(statusFilter), title: statusFilter === '40' ? 'Pendientes' : statusFilter === '41' ? 'Aprobadas' : 'Ejecutadas', accent: statusFilter === '40' ? 'amber' as const : statusFilter === '41' ? 'emerald' as const : 'slate' as const }];
  const selectedSourceLocationName = sourceLocations.find((location) => String(location.LocationID) === form.SourceLocationID)?.LocationName || '';
  const destinationOptionsForSelectedSource = selectedSourceLocationName
    ? (destinationOptionsBySource[selectedSourceLocationName] || [])
    : destinationLocations;

  function getStatusMeta(status?: number) {
    switch (status) {
      case 41:
        return { label: t('requests.requestStatus.approved'), icon: Check, className: 'bg-emerald-100 text-emerald-600' };
      case 42:
        return { label: 'Ejecutada', icon: Check, className: 'bg-slate-100 text-slate-600' };
      case 40:
      default:
        return { label: t('requests.requestStatus.pending'), icon: Clock, className: 'bg-amber-100 text-amber-600' };
    }
  }

  return (
    <Layout title={t('requests.title')}>
      <AnimatePresence mode="wait">
        {showCreate ? (
          <motion.div
            key="create"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">{t('requests.newRequest')}</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Tipo de solicitud</label>
                <select
                  value={form.RequestTypeID}
                  onChange={(e) => setForm((prev) => ({ ...prev, RequestTypeID: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                >
                  {requestTypes.map((type) => (
                    <option key={type.RequestTypeID} value={type.RequestTypeID}>{type.RequestType} {type.RequestDescription ? `- ${type.RequestDescription}` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Producto</label>
                <select
                  value={form.PartNumber}
                  onChange={(e) => {
                    const nextPart = e.target.value.toUpperCase();
                    const matched = inventoryOptions.find((item) => item.sku.toUpperCase() === nextPart);
                    setSelectedInventoryItem(matched || null);
                    setForm((prev) => ({ ...prev, PartNumber: nextPart }));
                  }}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                >
                  <option value="">Selecciona un producto del inventario</option>
                  {inventoryOptions.map((item) => (
                    <option key={item.inventoryId} value={item.sku}>{item.sku} - {item.name} ({item.stock} {item.unitType || 'u'})</option>
                  ))}
                </select>
                {selectedInventoryItem ? (
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                    Inventario real: {selectedInventoryItem.stock} {selectedInventoryItem.unitType || 'u'} • {selectedInventoryItem.locationName || 'Sin ubicación'}
                  </p>
                ) : null}
              </div>

              {form.RequestTypeID === '6' && (
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Lote de recepción</label>
                  <select
                    value={form.LotReceiveID}
                    onChange={(e) => setForm((prev) => ({ ...prev, LotReceiveID: e.target.value }))}
                    className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Selecciona un lote (solo en Storage)</option>
                    {lots.filter((lot) => lot.inStorage).map((lot) => {
                      const lotLabel = lot.InternalLot || lot.ShortInternalLot || lot.ProviderLot || `Lote ${lot.ReceiveID}`;
                      return (
                        <option key={lot.ReceiveID} value={lot.ReceiveID}>{lotLabel} {lot.PartNumber ? `- ${lot.PartNumber}` : ''}</option>
                      );
                    })}
                  </select>
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">Selecciona el lote para que el backend use la cantidad y el nombre correctos.</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Cantidad parcial</label>
                <input
                  type="number"
                  min="1"
                  max={maxAllowedQuantity ? String(maxAllowedQuantity) : undefined}
                  value={form.Quantity}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    const nextValue = maxAllowedQuantity ? Math.min(Number(rawValue || 0), maxAllowedQuantity) : Number(rawValue || 0);
                    setForm((prev) => ({ ...prev, Quantity: Number.isFinite(nextValue) && nextValue > 0 ? String(nextValue) : '1' }));
                  }}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                />
                {maxAllowedQuantity ? (
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">La cantidad parcial debe ajustarse al inventario disponible del producto seleccionado.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Ubicación origen</label>
                <select
                  value={form.SourceLocationID}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setForm((prev) => ({ ...prev, SourceLocationID: nextValue, DestinationLocationID: '' }));
                  }}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                >
                  <option value="">Sin origen</option>
                  {sourceLocations.map((location) => (
                    <option key={location.LocationID} value={location.LocationID}>{location.LocationName}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Ubicación destino</label>
                <select
                  value={form.DestinationLocationID}
                  onChange={(e) => setForm((prev) => ({ ...prev, DestinationLocationID: e.target.value }))}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                >
                  <option value="">Sin destino</option>
                  {destinationOptionsForSelectedSource.map((location) => (
                    <option key={location.LocationID} value={location.LocationID}>{location.LocationName}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">{t('requests.notesLabel')}</label>
                <textarea
                  rows={4}
                  value={form.Comments}
                  onChange={(e) => setForm((prev) => ({ ...prev, Comments: e.target.value }))}
                  placeholder={t('requests.placeholderReason')}
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium resize-none text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  {t('requests.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  <span>{submitting ? 'Guardando...' : t('requests.submit')}</span>
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
              <div className="flex flex-col items-center justify-center gap-3 py-3 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-[2rem] bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                  <FileText size={36} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Solicitudes</p>
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">Gestión de solicitudes</h2>
                </div>
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center justify-center gap-2 rounded-[1.3rem] bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm transition-all active:scale-95"
                >
                  <Plus size={16} />
                  <span>Nueva solicitud</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                onClick={() => void loadRequests()}
                className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-200"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'Todos' },
                  { value: '40', label: 'Pendientes' },
                  { value: '41', label: 'Aprobadas' },
                  { value: '42', label: 'Ejecutadas' },
                ].map((filter) => {
                  const active = statusFilter === filter.value;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setStatusFilter(filter.value as 'all' | '40' | '41' | '42')}
                      className={`rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition-all ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {loading ? (
              <div className="rounded-[2rem] border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/95">Cargando solicitudes...</div>
            ) : (
              <div className="space-y-3">
                {visibleGroups.map((group) => {
                  const items = requests.filter((req) => Number(req.RequestStatusID || 0) === group.id);
                  const shouldShowEmptyState = items.length === 0;
                  return (
                    <div key={group.id} className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{group.title}</h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{items.length} solicitud{items.length === 1 ? '' : 'es'}</p>
                        </div>
                        <div className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${group.accent === 'emerald' ? 'bg-emerald-100 text-emerald-700' : group.accent === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                          {group.title}
                        </div>
                      </div>

                      {shouldShowEmptyState ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          Sin solicitudes en este estatus.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {items.map((req, index) => {
                            const statusMeta = getStatusMeta(req.RequestStatusID);
                            const StatusIcon = statusMeta.icon;
                            const qty = Number(req.Quantity || 0);
                            const originName = req.SourceLocationID ? locationNames[req.SourceLocationID] || `#${req.SourceLocationID}` : null;
                            const destinationName = req.DestinationLocationID ? locationNames[req.DestinationLocationID] || `#${req.DestinationLocationID}` : null;

                            return (
                              <motion.div
                                key={req.RequestID}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.04 }}
                                className="rounded-[1.5rem] border border-slate-100 bg-slate-50/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-700/40"
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${statusMeta.className}`}>
                                    <StatusIcon size={18} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Solicitud #{req.RequestID}</p>
                                        <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{req.RequestName || req.PartNumber || 'Solicitud'}</h4>
                                      </div>
                                      <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black uppercase text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                                        {statusMeta.label}
                                      </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase text-slate-500 dark:text-slate-300">
                                      <span>{req.PartNumber || 'Sin producto'}</span>
                                      <span>•</span>
                                      <span>{Number.isFinite(qty) ? `${qty} unid.` : 'Sin cantidad'}</span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                      {originName ? <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">Origen: {originName}</span> : null}
                                      {destinationName ? <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Destino: {destinationName}</span> : null}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                    {req.RequestTypeName || req.RequestTypeDescription || 'Solicitud'}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => window.location.href = `/transfers?requestId=${req.RequestID}`}
                                    className="flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-black text-white shadow-sm transition-all active:scale-95"
                                  >
                                    <span>Transferir</span>
                                    <ChevronRight size={16} />
                                  </button>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
};
