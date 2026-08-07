import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

type LotInventoryOption = {
  LotInventoryID: number;
  LotReceiveID?: number;
  CurrentInternalLot?: string;
  CurrentQuantity?: number | string;
  CurrentLocationID?: number | null;
  PartNumber?: string;
  PartName?: string;
  UnitType?: string;
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
  const [lotInventoryOptions, setLotInventoryOptions] = useState<LotInventoryOption[]>([]);
  const [lotSearchText, setLotSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '40' | '41' | '42'>('all');
  const lotSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lotSearchTimeoutRef = useRef<number | null>(null);
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
  const location = useLocation();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    void loadRequests();
  }, []);

  useEffect(() => {
    if (showCreate && (form.RequestTypeID === '2' || form.RequestTypeID === '3' || form.RequestTypeID === '12')) {
      const timer = window.setTimeout(() => {
        lotSearchInputRef.current?.focus();
        lotSearchInputRef.current?.select();
      }, 180);
      return () => window.clearTimeout(timer);
    }
  }, [showCreate, form.RequestTypeID]);

  useEffect(() => {
    return () => {
      if (lotSearchTimeoutRef.current) {
        window.clearTimeout(lotSearchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!form.LotReceiveID) {
      setLotSearchText('');
      return;
    }
    const selectedLotInventory = lotInventoryOptions.find((item) => String(item.LotInventoryID) === String(form.LotReceiveID));
    if (selectedLotInventory) {
      setLotSearchText((prev) => prev || selectedLotInventory.CurrentInternalLot || '');
    }
  }, [form.LotReceiveID, lotInventoryOptions]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const incomingBridge = params.get('from') === 'inbound';
    const outboundBridge = params.get('from') === 'outbound';
    const lotInventoryId = params.get('lotInventoryId');
    const lotReference = params.get('lotReference') || '';

    if ((!incomingBridge && !outboundBridge) || !lotInventoryId) return;

    setShowCreate(true);
    setForm((prev) => ({
      ...prev,
      RequestTypeID: outboundBridge ? '12' : '3',
      LotReceiveID: String(lotInventoryId),
      PartNumber: prev.PartNumber || '',
      Quantity: prev.Quantity || '1',
      SourceLocationID: prev.SourceLocationID || '',
      DestinationLocationID: prev.DestinationLocationID || '',
      Comments: prev.Comments || '',
    }));

    if (lotInventoryOptions.length > 0) {
      const matchedLot = lotInventoryOptions.find((item) => String(item.LotInventoryID) === String(lotInventoryId));
      if (matchedLot) {
        selectLotById(matchedLot.LotInventoryID, lotReference, { autoSelectDestination: true, bridgeType: outboundBridge ? 'outbound' : 'inbound' });
      }
    } else {
      setLotSearchText(lotReference);
    }
  }, [location.search, lotInventoryOptions]);

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

  const isHiddenRequestType = (label?: string) => {
    if (!label) return false;
    const key = String(label).toLowerCase();
    return key.includes('consum') ||
      key.includes('consumption') ||
      key.includes('consumo') ||
      key.includes('scrap') ||
      key.includes('receipt') ||
      key.includes('adjustment') ||
      key.includes('return');
  };

  const getLotOptionLabel = (lot: LotInventoryOption) => {
    const lotLabel = lot.CurrentInternalLot || `Lote ${lot.LotInventoryID}`;
    const locationLabel = lot.CurrentLocationID ? ` • Origen ${locationNames[lot.CurrentLocationID] || `#${lot.CurrentLocationID}`}` : '';
    return `${lotLabel} • ${lot.PartNumber || 'Sin producto'} • Cantidad ${lot.CurrentQuantity ?? 0} • ${lot.PartName || 'Sin nombre'}${locationLabel}`;
  };

  const handleLotSearchChange = (value: string) => {
    const nextValue = value;
    setLotSearchText(nextValue);

    if (lotSearchTimeoutRef.current) {
      window.clearTimeout(lotSearchTimeoutRef.current);
      lotSearchTimeoutRef.current = null;
    }

    if (!nextValue.trim()) {
      setForm((prev) => ({ ...prev, LotReceiveID: '', SourceLocationID: prev.SourceLocationID, DestinationLocationID: '' }));
      setSelectedInventoryItem(null);
      return;
    }

    const normalizedValue = nextValue.trim().toLowerCase();
    const allowedLots = isPartialTransferRequest
      ? lotInventoryOptions.filter((lot) => isStorageLocationName(locationNames[lot.CurrentLocationID ?? 0]))
      : lotInventoryOptions;
    const matchingLots = allowedLots.filter((lot) => {
      const haystack = `${lot.CurrentInternalLot || ''} ${lot.PartNumber || ''} ${lot.PartName || ''} ${lot.CurrentQuantity ?? ''}`.toLowerCase();
      return haystack.includes(normalizedValue);
    });

    if (matchingLots.length === 1 && normalizedValue.length >= 2) {
      lotSearchTimeoutRef.current = window.setTimeout(() => {
        selectLotById(matchingLots[0].LotInventoryID, nextValue);
      }, 120);
    }
  };

  const selectLotById = (lotInventoryId: number | string | null, preserveText?: string, options?: { autoSelectDestination?: boolean }) => {
    if (lotSearchTimeoutRef.current) {
      window.clearTimeout(lotSearchTimeoutRef.current);
      lotSearchTimeoutRef.current = null;
    }
    const selectedLotInventory = lotInventoryOptions.find((item) => String(item.LotInventoryID) === String(lotInventoryId)) || null;
    const incomingBridge = new URLSearchParams(location.search).get('from') === 'inbound';
    const outboundBridge = new URLSearchParams(location.search).get('from') === 'outbound';
    const defaultDestinationId = incomingBridge
      ? (destinationLocations.find((location) => /stor|almac/i.test(String(location.LocationName || '')))?.LocationID?.toString() || '')
      : outboundBridge
        ? (destinationLocations.find((location) => /(produ|production|producción|produccion)/i.test(String(location.LocationName || '')))?.LocationID?.toString() || '')
        : '';
    const defaultSourceId = outboundBridge
      ? (selectedLotInventory?.CurrentLocationID ? String(selectedLotInventory.CurrentLocationID) : (sourceLocations.find((location) => /stor|almac/i.test(String(location.LocationName || '')))?.LocationID?.toString() || ''))
      : '';

    setForm((prev) => ({
      ...prev,
      LotReceiveID: selectedLotInventory ? String(selectedLotInventory.LotInventoryID) : '',
      PartNumber: selectedLotInventory?.PartNumber || prev.PartNumber,
      Quantity: selectedLotInventory?.CurrentQuantity ? String(selectedLotInventory.CurrentQuantity) : prev.Quantity,
      SourceLocationID: outboundBridge ? (defaultSourceId || prev.SourceLocationID) : (selectedLotInventory?.CurrentLocationID ? String(selectedLotInventory.CurrentLocationID) : prev.SourceLocationID),
      DestinationLocationID: options?.autoSelectDestination === false ? prev.DestinationLocationID : defaultDestinationId,
    }));
    if (selectedLotInventory) {
      const fallbackLotName = selectedLotInventory.CurrentInternalLot || '';
      setLotSearchText(preserveText ?? fallbackLotName);
    } else {
      setLotSearchText('');
    }
    if (selectedLotInventory?.PartNumber) {
      setSelectedInventoryItem({
        inventoryId: Number(selectedLotInventory.LotInventoryID),
        sku: selectedLotInventory.PartNumber || '',
        name: selectedLotInventory.PartName || selectedLotInventory.PartNumber || '',
        stock: selectedLotInventory.CurrentQuantity || 0,
        locationName: selectedLotInventory.CurrentLocationID ? (locationNames[selectedLotInventory.CurrentLocationID] || String(selectedLotInventory.CurrentLocationID)) : undefined,
        unitType: selectedLotInventory.UnitType || 'u',
      });
    } else {
      setSelectedInventoryItem(null);
    }
  };

  async function loadRequestTypes() {
    try {
      const r = await fetch('/api/request-types');
      const d = await r.json();
      const allTypes = Array.isArray(d.requestTypes) ? d.requestTypes : [];
      // Exclude consumption-type and the unsupported PDA request types from the general Requests UI
      const params = new URLSearchParams(window.location.search);
      const outboundBridge = params.get('from') === 'outbound';

      const filteredTypes = outboundBridge
        ? allTypes.filter((t: any) => [3, 12].includes(Number(t.RequestTypeID)))
        : allTypes.filter(
            (t: any) =>
              !isHiddenRequestType(t.RequestType || t.RequestDescription)
          );

      setRequestTypes(filteredTypes);
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

  async function loadLotInventoryOptions() {
    try {
      const r = await fetch('/api/requests/lots?limit=100');
      const d = await r.json();
      const nextOptions = Array.isArray(d.lots)
        ? d.lots
            .filter((lot: any) =>
              lot?.CurrentLocationID != null &&
              lot?.CurrentLocationID !== '' &&
              Number(lot?.CurrentQuantity ?? lot?.Quantity ?? 0) > 0
            )
            .map((lot: any) => ({
              LotInventoryID: lot.LotInventoryID,
              LotReceiveID: lot.ReceiveID,
              CurrentInternalLot: lot.CurrentInternalLot || lot.InternalLot || lot.ShortInternalLot || lot.ProviderLot || `Lote ${lot.ReceiveID || lot.LotInventoryID}`,
              CurrentQuantity: lot.CurrentQuantity ?? lot.Quantity ?? 0,
              CurrentLocationID: lot.CurrentLocationID ?? null,
              PartNumber: lot.PartNumber,
              PartName: lot.PartName || lot.PartNumber || '',
              UnitType: lot.UnitType || 'u',
            }))
        : [];
      setLotInventoryOptions(nextOptions);
    } catch (e) {
      console.error('Error loading lot inventory options', e);
      setLotInventoryOptions([]);
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
      await Promise.all([loadLocationNames(), loadRequestTypes(), loadLots(), loadLotInventoryOptions(), loadInventoryOptions()]);
      const r = await fetch('/api/requests?limit=100');
      const d = await r.json();
      const all = Array.isArray(d.requests) ? d.requests : [];
      // Remove requests that are handled by the Salidas module and those that should not appear in the PDA Requests UI
      setRequests(all.filter((req: any) => {
        // Los tipos 3 (Consumo) y 12 (Transferencia parcial) siempre deben
        // listarse aquí aunque su etiqueta coincida con isHiddenRequestType
        // (p.ej. "CONSUMPTION" matchea el filtro de "consum").
        if ([3, 12].includes(Number(req.RequestTypeID))) return true;
        return !isHiddenRequestType(req.RequestTypeName || req.RequestTypeDescription);
      }));
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

    const selectedRequestTypeId = Number(form.RequestTypeID);
    const normalizedPartNumber = form.PartNumber.trim();
    const normalizedQty = Number(form.Quantity);

    if (selectedRequestTypeId === 2 || selectedRequestTypeId === 3 || selectedRequestTypeId === 12) {
      const selectedLotInventory = lotInventoryOptions.find((item) => String(item.LotInventoryID) === String(form.LotReceiveID));
      if (!selectedLotInventory) {
        alert('Selecciona un lote de inventario para la transferencia');
        return;
      }
      if (!selectedLotInventory.PartNumber) {
        alert('No se pudo identificar el producto del lote seleccionado');
        return;
      }
      if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
        alert('Ingresa una cantidad válida');
        return;
      }
      if ((selectedRequestTypeId === 12 || selectedRequestTypeId === 3) && maxAllowedQuantity != null && normalizedQty > maxAllowedQuantity) {
        alert(`La cantidad no puede superar el stock disponible en el lote (${maxAllowedQuantity}).`);
        return;
      }
      if (selectedRequestTypeId === 12 && !isStorageLocationName(locationNames[selectedLotInventory.CurrentLocationID ?? 0])) {
        alert('Para transferencias parciales solo se puede seleccionar un lote que esté en Storage.');
        return;
      }
    } else if (!normalizedPartNumber || !Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      alert('Ingresa un producto y una cantidad válida');
      return;
    }

    setSubmitting(true);
    try {
      const selectedLotInventory = selectedRequestTypeId === 2 || selectedRequestTypeId === 3 || selectedRequestTypeId === 12
        ? lotInventoryOptions.find((item) => String(item.LotInventoryID) === String(form.LotReceiveID)) || null
        : null;
      const payload = {
        RequestTypeID: selectedRequestTypeId || 2,
        RequestStatusID: 40,
        PartNumber: selectedLotInventory?.PartNumber || normalizedPartNumber,
        Quantity: selectedRequestTypeId === 2
          ? (selectedLotInventory ? Number(selectedLotInventory.CurrentQuantity || 0) : normalizedQty)
          : normalizedQty,
        RegUserID: user?.id ? Number(user.id) : undefined,
        Comments: form.Comments.trim() || undefined,
        SourceLocationID: selectedLotInventory?.CurrentLocationID ? Number(selectedLotInventory.CurrentLocationID) : (form.SourceLocationID ? Number(form.SourceLocationID) : undefined),
        DestinationLocationID: form.DestinationLocationID ? Number(form.DestinationLocationID) : undefined,
        LotReceiveID: (selectedRequestTypeId === 2 || selectedRequestTypeId === 3 || selectedRequestTypeId === 12) && selectedLotInventory?.LotReceiveID ? Number(selectedLotInventory.LotReceiveID) : (form.RequestTypeID === '6' && form.LotReceiveID ? Number(form.LotReceiveID) : undefined),
        LotInventoryID: (selectedRequestTypeId === 2 || selectedRequestTypeId === 3 || selectedRequestTypeId === 12) && selectedLotInventory?.LotInventoryID ? Number(selectedLotInventory.LotInventoryID) : undefined,
      };

      const r = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      
      if (!r.ok) throw new Error(d.message || 'No se pudo crear la solicitud');

      const responseERP = await fetch(
        '/api/erp/create-stock-entry',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: d.requestId,
            request_type_id: selectedRequestTypeId
          }),
        }
      )
      
      const dataERP = await responseERP.json();

      if (!responseERP.ok) {
        throw new Error(
          dataERP.message || 'Error al crear el movimiento en MES Web'
        );
      }

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
  const isFullTransferRequest = form.RequestTypeID === '2';
  const isPartialTransferRequest = form.RequestTypeID === '12';
  const isConsumptionRequest = form.RequestTypeID === '3';
  const isTransferRequest = isFullTransferRequest || isPartialTransferRequest || isConsumptionRequest;
  const isStorageLocationName = (locationName?: string) => {
    const normalized = String(locationName || '').toLowerCase();
    return /stor|almac/.test(normalized);
  };

  const filteredLotOptions = lotInventoryOptions.filter((lot) => {
    const search = lotSearchText.trim().toLowerCase();
    if (!search) return true;
    const haystack = `${lot.CurrentInternalLot || ''} ${lot.PartNumber || ''} ${lot.PartName || ''} ${lot.CurrentQuantity ?? ''} ${lot.CurrentLocationID ?? ''}`.toLowerCase();
    return haystack.includes(search);
  });
  const visibleLotOptions = isPartialTransferRequest
    ? filteredLotOptions.filter((lot) => isStorageLocationName(locationNames[lot.CurrentLocationID ?? 0]))
    : filteredLotOptions;
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
  const incomingBridge = new URLSearchParams(location.search).get('from') === 'inbound';
  const outboundBridge = new URLSearchParams(location.search).get('from') === 'outbound';
  const defaultInboundDestinationId = destinationLocations.find((location) => /stor|almac/i.test(String(location.LocationName || '')))?.LocationID?.toString() || '';
  const defaultOutboundDestinationId = destinationLocations.find((location) => /(produ|production|producción|produccion)/i.test(String(location.LocationName || '')))?.LocationID?.toString() || '';

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

              {!(form.RequestTypeID === '2' || form.RequestTypeID === '3' || form.RequestTypeID === '12') ? (
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
              ) : null}

              {(form.RequestTypeID === '2' || form.RequestTypeID === '3' || form.RequestTypeID === '12') && (
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Lote de inventario / transferencia</label>
                  <input
                    ref={lotSearchInputRef}
                    type="text"
                    autoComplete="off"
                    value={lotSearchText}
                    onChange={(e) => handleLotSearchChange(e.target.value)}
                    onInput={(e) => handleLotSearchChange((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && visibleLotOptions.length === 1) {
                        e.preventDefault();
                        selectLotById(visibleLotOptions[0].LotInventoryID, lotSearchText);
                      }
                    }}
                    placeholder="Escribe el lote y selecciónalo"
                    className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100"
                  />
                  {lotSearchText.trim() ? (
                    <div className="max-h-48 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
                      {visibleLotOptions.length > 0 ? visibleLotOptions.map((lot) => (
                        <button
                          key={lot.LotInventoryID}
                          type="button"
                          onClick={() => selectLotById(lot.LotInventoryID)}
                          className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          {getLotOptionLabel(lot)}
                        </button>
                      )) : (
                        <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No hay lotes que coincidan con la búsqueda.</p>
                      )}
                    </div>
                  ) : null}
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">Escribe el lote y elige la coincidencia para llenar automáticamente el producto, la cantidad y la ubicación de origen.</p>
                </div>
              )}

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
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Cantidad</label>
                <input
                  type="number"
                  min="1"
                  max={maxAllowedQuantity ? String(maxAllowedQuantity) : undefined}
                  value={form.Quantity}
                  readOnly={isFullTransferRequest}
                  disabled={isFullTransferRequest}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    const nextValue = maxAllowedQuantity ? Math.min(Number(rawValue || 0), maxAllowedQuantity) : Number(rawValue || 0);
                    setForm((prev) => ({ ...prev, Quantity: Number.isFinite(nextValue) && nextValue > 0 ? String(nextValue) : '1' }));
                  }}
                  className={`w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100 ${isFullTransferRequest ? 'bg-slate-100 text-slate-500 cursor-not-allowed dark:bg-slate-700/70 dark:text-slate-400' : ''}`}
                />
                {maxAllowedQuantity ? (
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">{isFullTransferRequest ? 'La cantidad se toma directamente del lote seleccionado.' : 'La cantidad parcial puede ajustarse hasta el stock disponible del lote seleccionado.'}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Ubicación origen</label>
                <select
                  value={form.SourceLocationID}
                  disabled={isTransferRequest}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setForm((prev) => ({ ...prev, SourceLocationID: nextValue, DestinationLocationID: '' }));
                  }}
                  className={`w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100 ${isTransferRequest ? 'bg-slate-100 text-slate-500 cursor-not-allowed dark:bg-slate-700/70 dark:text-slate-400' : ''}`}
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
                  value={incomingBridge ? (form.DestinationLocationID || defaultInboundDestinationId) : outboundBridge ? (form.DestinationLocationID || defaultOutboundDestinationId) : form.DestinationLocationID}
                  onChange={(e) => {
                    if (incomingBridge || outboundBridge) return;
                    setForm((prev) => ({ ...prev, DestinationLocationID: e.target.value }));
                  }}
                  disabled={incomingBridge || outboundBridge}
                  className={`w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100 ${(incomingBridge || outboundBridge) ? 'bg-slate-100 text-slate-500 cursor-not-allowed dark:bg-slate-700/70 dark:text-slate-400' : ''}`}
                >
                  <option value="">Sin destino</option>
                  {destinationOptionsForSelectedSource.map((location) => (
                    <option key={location.LocationID} value={location.LocationID}>{location.LocationName}</option>
                  ))}
                </select>
                {(incomingBridge || outboundBridge) ? (
                  <p className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                    El destino viene fijado por el flujo de {incomingBridge ? 'Entradas' : 'Salidas'} y no se puede cambiar.
                  </p>
                ) : null}
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
                                  {group.id === 41 ? (
                                    <button
                                      type="button"
                                      onClick={() => window.location.href = `/transfers?requestId=${req.RequestID}`}
                                      className="flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-black text-white shadow-sm transition-all active:scale-95"
                                    >
                                      <span>Transferir</span>
                                      <ChevronRight size={16} />
                                    </button>
                                  ) : null}
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
