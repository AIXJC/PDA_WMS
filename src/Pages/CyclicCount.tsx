import React, { useEffect, useState, useRef } from 'react';
import { RefreshCw, Check, Package, AlertCircle, Scan, LoaderCircle, Plus, X } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';
import { notifyAppRefresh, useAppRefresh } from '../utils/realtime';

interface CycleCount {
  CycleCountID: number;
  LocationID: number;
  StatusID: number;
  PackCount: number;
  InventoryID: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  StatusCode: string;
  StatusDescription: string;
  PartNumber: string;
  CurrentQuantity: number;
  PartName: string;
  WorkArea: string;
  InventoryItemCount: number;
}

interface CycleItem {
  InventoryID: number;
  PartNumber: string;
  PartName: string;
  WorkArea: string;
  PartType: string;
  UnitType: string;
  CurrentQuantity: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  LocationName: string;
  LotInventoryID?: number;
  LotReceiveID?: number;
  CurrentInternalLot?: string;
  LotCurrentQuantity?: number;
}

interface StorageLocation {
  StorageID: number;
  RackName: string;
  RackColumn: number;
  RackCell: number;
  LocationID: number;
  LocationName?: string;
  OccupiedItemCount?: number;
  OccupiedQuantity?: number;
  Status?: string;
}

interface RackColumnGroup<T> {
  rackColumn: number;
  items: T[];
}

interface RackGroup<T> {
  rackName: string;
  columns: RackColumnGroup<T>[];
  items: T[];
}

const formatLocationCode = (rackName: string, rackColumn: number, rackCell: number) => {
  return `${rackName || 'Sin rack'}-${Number(rackColumn || 0)}-${Number(rackCell || 0)}`;
};

export const CyclicCount: React.FC = () => {
  const [cycles, setCycles] = useState<CycleCount[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [cycleItems, setCycleItems] = useState<CycleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [counting, setCounting] = useState(false);
  const [scannedItems, setScannedItems] = useState<{ inventoryId: number; sku: string; name: string; quantity: number; lotInventoryId?: number; lotReceiveId?: number }[]>([]);
  const [countValues, setCountValues] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loadingAdjustments, setLoadingAdjustments] = useState(false);
  const [reviewingAdjustmentId, setReviewingAdjustmentId] = useState<number | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [flowStep, setFlowStep] = useState<'start' | 'scanning' | 'review' | 'complete'>('start');
  const [currentCellSummary, setCurrentCellSummary] = useState<string>('');
  
  // Nuevo: Modal de crear ciclo
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [selectedRackFilter, setSelectedRackFilter] = useState<string>('all');
  const [mapRackFilter, setMapRackFilter] = useState<string>('all');
  const [creatingCycle, setCreatingCycle] = useState(false);
  const [cancelingCycle, setCancelingCycle] = useState(false);
  const [lotInput, setLotInput] = useState('');
  const [lotScanned, setLotScanned] = useState(false);
  const [activeLotLabel, setActiveLotLabel] = useState('');
  const qrInputRef = useRef<HTMLInputElement>(null);

  const loadCycles = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoadingCycles(true);
      }
      const res = await fetch('/api/cyclic-count?limit=50');
      if (!res.ok) throw new Error('Error loading cycles');
      const data = await res.json();
      setCycles(Array.isArray(data.cycles) ? data.cycles : []);
    } catch (err) {
      if (showLoading) {
        setError(err instanceof Error ? err.message : 'Error cargando ciclos');
      }
    } finally {
      if (showLoading) {
        setLoadingCycles(false);
      }
    }
  };

  const loadLocations = async () => {
    setLoadingLocations(true);
    try {
      const res = await fetch('/api/storage-locations?limit=1000');
      if (!res.ok) throw new Error('Error cargando ubicaciones');
      const data = await res.json();
      setLocations(Array.isArray(data.locations) ? data.locations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ubicaciones');
    } finally {
      setLoadingLocations(false);
    }
  };

  useEffect(() => {
    void loadCycles();
    void loadLocations();
  }, []);

  const loadAdjustments = async () => {
    setLoadingAdjustments(true);
    try {
      const res = await fetch('/api/cyclic-count/adjustments');
      if (!res.ok) throw new Error('Error cargando ajustes');
      const data = await res.json();
      setAdjustments(Array.isArray(data.adjustments) ? data.adjustments : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ajustes');
    } finally {
      setLoadingAdjustments(false);
    }
  };

  useEffect(() => {
    void loadAdjustments();
  }, []);

  useAppRefresh(() => {
    void loadCycles(false);
  }, 10000);

  const rackLocationGroups = React.useMemo(() => {
    const grouped = new Map<string, StorageLocation[]>();
    for (const location of locations) {
      const rackName = location.RackName || 'Sin rack';
      if (!grouped.has(rackName)) grouped.set(rackName, []);
      grouped.get(rackName)!.push(location);
    }
    return [...grouped.entries()]
      .map(([rackName, items]) => ({
        rackName,
        items: items.sort((a, b) => a.RackColumn - b.RackColumn || a.RackCell - b.RackCell),
      }))
      .sort((a, b) => a.rackName.localeCompare(b.rackName));
  }, [locations]);

  const visibleRackLocationGroups = React.useMemo(() => {
    if (selectedRackFilter === 'all') return rackLocationGroups;
    return rackLocationGroups.filter((group) => group.rackName === selectedRackFilter);
  }, [rackLocationGroups, selectedRackFilter]);

  const locationRackGroups = React.useMemo(() => {
    const grouped = new Map<string, Map<number, StorageLocation[]>>();

    for (const location of locations) {
      const rackName = location.RackName || 'Sin rack';
      const rackColumn = Number(location.RackColumn || 0);

      if (!grouped.has(rackName)) {
        grouped.set(rackName, new Map());
      }

      const columnMap = grouped.get(rackName)!;
      if (!columnMap.has(rackColumn)) {
        columnMap.set(rackColumn, []);
      }
      columnMap.get(rackColumn)!.push(location);
    }

    return [...grouped.entries()].map(([rackName, columnMap]) => {
      const columns = [...columnMap.entries()]
        .map(([rackColumn, items]) => ({
          rackColumn,
          items: items.sort((a, b) => a.RackCell - b.RackCell),
        }))
        .sort((a, b) => a.rackColumn - b.rackColumn);

      return {
        rackName,
        columns,
        items: columns.flatMap((column) => column.items),
      };
    }).sort((a, b) => a.rackName.localeCompare(b.rackName));
  }, [locations]);

  const rackFilterOptions = React.useMemo(() => {
    return ['all', ...new Set(locationRackGroups.map((group) => group.rackName))];
  }, [locationRackGroups]);

  const visibleMapRackGroups = React.useMemo<RackGroup<StorageLocation>[]>(() => {
    if (mapRackFilter === 'all') return locationRackGroups;
    return locationRackGroups.filter((group) => group.rackName === mapRackFilter);
  }, [locationRackGroups, mapRackFilter]);

  const cycleRackGroups = React.useMemo(() => {
    const grouped = new Map<string, Map<number, CycleCount[]>>();

    for (const cycle of cycles) {
      const rackName = cycle.RackName || 'Sin rack';
      const rackColumn = Number(cycle.RackColumn || 0);

      if (!grouped.has(rackName)) {
        grouped.set(rackName, new Map());
      }

      const columnMap = grouped.get(rackName)!;
      if (!columnMap.has(rackColumn)) {
        columnMap.set(rackColumn, []);
      }
      columnMap.get(rackColumn)!.push(cycle);
    }

    return [...grouped.entries()].map(([rackName, columnMap]) => {
      const columns = [...columnMap.entries()]
        .map(([rackColumn, items]) => ({
          rackColumn,
          items: items.sort((a, b) => (a.RackCell || 0) - (b.RackCell || 0)),
        }))
        .sort((a, b) => a.rackColumn - b.rackColumn);

      return {
        rackName,
        columns,
        items: columns.flatMap((column) => column.items),
      };
    }).sort((a, b) => a.rackName.localeCompare(b.rackName));
  }, [cycles]);

  const handleOpenCreateModal = async () => {
    setShowCreateModal(true);
    setSelectedRackFilter('all');
    setLocationInput('');
    setLoadingLocations(true);
    try {
      const res = await fetch('/api/storage-locations?limit=1000');
      if (!res.ok) throw new Error('Error cargando ubicaciones');
      const data = await res.json();
      setLocations(Array.isArray(data.locations) ? data.locations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ubicaciones');
    } finally {
      setLoadingLocations(false);
      setTimeout(() => qrInputRef.current?.focus(), 100);
    }
  };

  const handleCreateCycle = async (locationId: number) => {
    setCreatingCycle(true);
    try {
      const res = await fetch('/api/cyclic-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      });
      if (!res.ok) throw new Error('Error creando ciclo');
      const data = await res.json();
      
      // Agregar el nuevo ciclo al inicio de la lista y cargar sus items
      if (data.cycle) {
        setCycles(prev => [data.cycle, ...prev]);
        await handleSelectCycle(data.cycle.CycleCountID);
      }
      notifyAppRefresh('action');
      setShowCreateModal(false);
      setLocationInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando ciclo');
    } finally {
      setCreatingCycle(false);
    }
  };

  const handleQrScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && locationInput.trim()) {
      const searchId = locationInput.trim();
      const location = locations.find(l => 
        l.StorageID.toString() === searchId || 
        `${l.RackName}-${l.RackColumn}-${l.RackCell}` === searchId
      );
      if (location) {
        handleCreateCycle(location.StorageID);
      } else {
        setError('Ubicación no encontrada');
      }
    }
  };

  const handleSelectCycle = async (cycleId: number) => {
    setSelectedCycleId(cycleId);
    setScannedItems([]);
    setCountValues({});
    setCounting(false);
    setFlowStep('start');
    setCurrentCellSummary('');
    setLotInput('');
    setLotScanned(false);
    setActiveLotLabel('');
    setLoadingItems(true);
    try {
      const res = await fetch(`/api/cyclic-count/${cycleId}/items`);
      if (!res.ok) throw new Error('Error loading cycle items');
      const data = await res.json();
      setCycleItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando ítems');
    } finally {
      setLoadingItems(false);
    }
  };

  const handleQuantityChange = (inventoryId: number, value: string) => {
    const parsed = Number(value);
    setCountValues(prev => ({
      ...prev,
      [inventoryId]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };

  const getItemCountStatus = (item: CycleItem) => {
    const countedQty = Number(countValues[item.InventoryID] ?? item.CurrentQuantity ?? 0);
    const currentQty = Number(item.CurrentQuantity ?? 0);

    if (countValues[item.InventoryID] === undefined) {
      return 'pending';
    }
    if (countedQty === currentQty) {
      return 'ok';
    }
    if (countedQty > currentQty) {
      return 'high';
    }
    return 'low';
  };

  const getStatusClasses = (status: string) => {
    switch (status) {
      case 'ok':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'high':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'low':
        return 'bg-rose-100 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-500 border-slate-200';
    }
  };

  const handleRegisterItem = (item: CycleItem) => {
    const quantity = Number(countValues[item.InventoryID] ?? item.CurrentQuantity ?? 1);
    const safeQuantity = Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;

    setCountValues(prev => ({
      ...prev,
      [item.InventoryID]: safeQuantity,
    }));

    setScannedItems(prev => {
      const existingIndex = prev.findIndex(entry => entry.inventoryId === item.InventoryID);
      const newEntry = {
        inventoryId: item.InventoryID,
        sku: item.PartNumber,
        name: item.PartName,
        quantity: safeQuantity,
        lotInventoryId: item.LotInventoryID,
        lotReceiveId: item.LotReceiveID,
      };

      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = newEntry;
        return next;
      }

      return [...prev, newEntry];
    });
  };

  const handleReviewAdjustment = async (requestId: number, action: 'approve' | 'reject') => {
    setReviewingAdjustmentId(requestId);
    setReviewAction(action);
    try {
      const res = await fetch(`/api/cyclic-count/adjustments/${requestId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Error ${action === 'approve' ? 'aprobando' : 'rechazando'} ajuste`);
      await loadAdjustments();
      setReviewingAdjustmentId(null);
      setReviewAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error procesando ajuste');
    } finally {
      setReviewingAdjustmentId(null);
      setReviewAction(null);
    }
  };

  const handleConfirmLotScan = () => {
    const normalizedLot = lotInput.trim();
    if (!normalizedLot) {
      setError('Escanea o ingresa el lote para continuar.');
      return;
    }

    setLotScanned(true);
    setActiveLotLabel(normalizedLot);
    setError('');
    setCurrentCellSummary(`Rack ${selectedCycle?.RackName || 'seleccionado'} • Lote ${normalizedLot} listo para contar.`);
  };

  const handleStartCounting = () => {
    if (!lotScanned || !activeLotLabel) {
      setError('Primero escanea el lote para comenzar el conteo.');
      return;
    }

    setCounting(true);
    setFlowStep('scanning');
    setCurrentCellSummary(`Conteo iniciado para ${selectedCycle?.RackName || 'la celda'} • Lote ${activeLotLabel}`);
  };

  const handleFinishCell = async () => {
    setFlowStep('review');
    setCurrentCellSummary('Revisión del conteo finalizada. El sistema prepara el ajuste si aplica.');
  };

  const handleContinueNextCell = () => {
    setFlowStep('start');
    setCurrentCellSummary('Listo para continuar con la siguiente celda.');
    setCounting(false);
  };

  const resetActiveCycleState = () => {
    setSelectedCycleId(null);
    setCounting(false);
    setScannedItems([]);
    setCountValues({});
    setFlowStep('start');
    setCurrentCellSummary('');
    setLotInput('');
    setLotScanned(false);
    setActiveLotLabel('');
  };

  const handleCancelCurrentCycle = async () => {
    if (!selectedCycleId) return;

    const confirmed = window.confirm('¿Estas seguro de que quieres dejar en Proceso el conteo Ciclico?');
    if (!confirmed) return;

    setCancelingCycle(true);
    try {
      const res = await fetch(`/api/cyclic-count/${selectedCycleId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Error cancelando conteo');
      await loadCycles();
      resetActiveCycleState();
      notifyAppRefresh('action');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cancelando conteo');
    } finally {
      setCancelingCycle(false);
    }
  };

  const handleCompleteCycle = async () => {
    if (!selectedCycleId) return;

    const payload = cycleItems
      .map((item) => {
        const quantity = countValues[item.InventoryID];
        if (quantity === undefined) return null;
        return {
          inventoryId: item.InventoryID,
          countedQty: quantity,
          lotInventoryId: item.LotInventoryID,
        };
      })
      .filter((item): item is { inventoryId: number; countedQty: number; lotInventoryId: number | undefined } => item !== null);

    if (payload.length === 0 && cycleItems.length > 0) {
      setError('Registra al menos un producto antes de finalizar el conteo.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/cyclic-count/${selectedCycleId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scannedItems: payload }),
      });
      if (!res.ok) throw new Error('Error saving cycle count');
      setSelectedCycleId(null);
      setCounting(false);
      setScannedItems([]);
      setCountValues({});
      setCycles(prev => prev.map(c => c.CycleCountID === selectedCycleId ? {
        ...c,
        StatusID: 46,
        StatusCode: 'COMPLETED',
        StatusDescription: 'completado',
        PackCount: payload.length,
      } : c));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error completando conteo');
    } finally {
      setSaving(false);
    }
  };

  const selectedCycle = selectedCycleId ? cycles.find(c => c.CycleCountID === selectedCycleId) : null;
  const scannedInventoryIds = new Set(scannedItems.map(item => item.inventoryId));
  const scannedCycleItems = cycleItems.filter(item => scannedInventoryIds.has(item.InventoryID));
  const pendingCycleItems = cycleItems.filter(item => !scannedInventoryIds.has(item.InventoryID));
  const cellCurrentInventory = cycleItems.reduce((sum, item) => sum + Number(item.CurrentQuantity || 0), 0);
  const cellScannedQuantity = scannedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  if (selectedCycleId && selectedCycle) {
    if (counting) {
      return (
        <Layout title={`Contando - ${selectedCycle.RackName}`}>
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-xl space-y-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Rack escaneado</p>
                  <h2 className="text-2xl font-black">{selectedCycle.RackName} - {selectedCycle.WorkArea}</h2>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black">{scannedCycleItems.length}/{cycleItems.length}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Escaneados</p>
                </div>
              </div>
              <div className="w-full bg-slate-700 h-3 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(scannedCycleItems.length / (cycleItems.length || 1)) * 100}%` }}
                  className="h-full bg-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-white/10 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Inventario actual</p>
                  <p className="mt-1 text-lg font-black">{cellCurrentInventory.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl bg-white/10 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Falta por escanear</p>
                  <p className="mt-1 text-lg font-black">{pendingCycleItems.length}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Resumen</p>
                <p className="mt-1 font-semibold text-slate-100">{scannedCycleItems.length > 0 ? 'Hay seguimiento de los ítems ya registrados en esta celda.' : 'Aún no se ha registrado ningún ítem de esta celda.'}</p>
                <p className="mt-1 text-xs text-slate-300">Lote activo: {activeLotLabel || 'Pendiente de escanear'}</p>
                <p className="mt-1 text-xs text-slate-300">Unidades registradas en esta sesión: {cellScannedQuantity.toFixed(2)}</p>
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estado de la celda</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">{currentCellSummary || 'Primero escanea el rack y luego el lote para iniciar el conteo.'}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Escanea el lote</p>
                <input
                  type="text"
                  value={lotInput}
                  onChange={(e) => setLotInput(e.target.value)}
                  placeholder="Ej.: LOTE-001"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                />
                <div className="mt-3 flex gap-2">
                  <button onClick={handleConfirmLotScan} className="flex-1 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-black uppercase text-white">Confirmar lote</button>
                  <button onClick={handleStartCounting} className="flex-1 rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-black uppercase text-white">Empezar conteo</button>
                </div>
                {lotScanned && activeLotLabel ? (
                  <p className="mt-2 text-xs font-semibold text-emerald-700">Lote activo: {activeLotLabel}</p>
                ) : null}
              </div>

              <div className="flex gap-2">
                <button onClick={handleFinishCell} className="flex-1 rounded-2xl bg-slate-200 px-3 py-2 text-sm font-black uppercase text-slate-700">Finalizar celda</button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800/95 rounded-[2.5rem] p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
              <div className="w-24 h-24 bg-blue-50 dark:bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Scan size={48} className="text-blue-500" />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 mb-2">Selecciona un producto</h3>
              <p className="text-sm text-slate-500 dark:text-slate-300 font-medium">Haz clic en el botón de abajo o toca un item de la lista</p>
            </div>

            {cycleItems.length > 0 && (
              <div className="space-y-3">
                {cycleItems.map((item, idx) => (
                  <motion.div
                    key={item.InventoryID}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="w-full bg-white dark:bg-slate-800/95 p-4 rounded-[1.5rem] border-2 border-slate-100 dark:border-slate-700"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <p className="text-[9px] font-black text-slate-400 dark:text-slate-300 uppercase">{item.PartNumber}</p>
                        <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{item.PartName}</h4>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${scannedInventoryIds.has(item.InventoryID) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                            {scannedInventoryIds.has(item.InventoryID) ? 'Escaneado' : 'Pendiente'}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            Inventario actual: {Number(item.CurrentQuantity || 0).toFixed(2)}
                          </span>
                        </div>
                        {item.LotInventoryID ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Lote: {item.CurrentInternalLot || item.LotReceiveID || item.LotInventoryID}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Cantidad</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={countValues[item.InventoryID] ?? item.CurrentQuantity ?? 1}
                          onChange={(e) => handleQuantityChange(item.InventoryID, e.target.value)}
                          className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/70 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${getStatusClasses(getItemCountStatus(item))}`}>
                          {getItemCountStatus(item) === 'ok' && 'Igual'}
                          {getItemCountStatus(item) === 'high' && 'Alta'}
                          {getItemCountStatus(item) === 'low' && 'Baja'}
                          {getItemCountStatus(item) === 'pending' && 'Pendiente'}
                        </span>
                        <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">Actual: {Number(item.CurrentQuantity || 0).toFixed(0)}</span>
                      </div>
                      <button
                        onClick={() => handleRegisterItem(item)}
                        className="w-full bg-blue-600 text-white py-3 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
                      >
                        Registrar
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {scannedItems.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-400 uppercase ml-2">Ítems escaneados</h4>
                <div className="flex flex-wrap gap-2">
                  {scannedItems.slice(-8).map((item, i) => (
                    <span key={i} className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
                      {item.sku}{item.lotInventoryId ? ` / Lote ${item.lotInventoryId}` : ''} × {item.quantity}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {flowStep === 'review' && (
              <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Revisión</p>
                <p className="mt-2 text-sm font-semibold text-amber-800">Se puede continuar con otra celda o crear un ajuste si hay diferencia.</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={handleContinueNextCell} className="flex-1 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-black uppercase text-white">Continuar siguiente celda</button>
                  <button onClick={() => handleCompleteCycle()} className="flex-1 rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-black uppercase text-white">Finalizar sin ajuste</button>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button 
                onClick={handleCancelCurrentCycle}
                disabled={cancelingCycle}
                className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-60"
              >
                {cancelingCycle ? 'Cancelando...' : 'Cancelar'}
              </button>
              <button 
                onClick={() => handleCompleteCycle()}
                disabled={saving}
                className="flex-1 bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span>{saving ? 'Guardando...' : 'Finalizar'}</span>
                <Check size={18} />
              </button>
            </div>
          </div>
        </Layout>
      );
    }

    return (
      <Layout title={`Ciclo ${selectedCycle.CycleCountID}`}>
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800/95 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-widest mb-1">Ubicación</p>
                <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">{selectedCycle.RackName} - Rack {selectedCycle.RackColumn} Celda {selectedCycle.RackCell}</h2>
              </div>
              <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${
                selectedCycle.StatusCode === 'COMPLETED' ? 'bg-emerald-100 text-emerald-600' :
                'bg-blue-100 text-blue-600'
              }`}>
                {selectedCycle.StatusDescription}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-700/70 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase mb-1">Cantidad Total</p>
                <p className="text-xl font-black text-slate-900 dark:text-slate-100">{Number(selectedCycle.CurrentQuantity || 0).toFixed(2)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/70 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase mb-1">Items Área</p>
                <p className="text-xl font-black text-blue-600 dark:text-blue-400">{selectedCycle.InventoryItemCount || cycleItems.length}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Paso 1: escanear lote</p>
              <p className="mt-2 text-sm font-semibold text-slate-700">Antes de contar por pieza, debes escanear o ingresar el lote asociado a esta celda para identificar el contenido del conteo.</p>
              <input
                type="text"
                value={lotInput}
                onChange={(e) => setLotInput(e.target.value)}
                placeholder="Ej.: LOTE-001"
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    const normalizedLot = lotInput.trim();
                    if (!normalizedLot) {
                      setError('Escanea o ingresa el lote para continuar.');
                      return;
                    }
                    setLotScanned(true);
                    setActiveLotLabel(normalizedLot);
                    setCurrentCellSummary(`Lote ${normalizedLot} confirmado para la celda.`);
                    setError('');
                  }}
                  className="flex-1 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-black uppercase text-white"
                >
                  Confirmar lote
                </button>
              </div>
              {lotScanned && activeLotLabel ? (
                <p className="mt-2 text-xs font-semibold text-emerald-700">Lote activo: {activeLotLabel}</p>
              ) : null}
            </div>
          </div>

          {loadingItems ? (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <LoaderCircle className="mr-2 animate-spin" size={18} />
              Cargando items...
            </div>
          ) : (
            <>
              <button 
                onClick={handleStartCounting}
                disabled={!lotScanned || !activeLotLabel}
                className="w-full bg-blue-600 text-white py-6 rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-60"
              >
                <Scan size={24} />
                <span>Iniciar Conteo</span>
              </button>

              <button 
                onClick={() => {
                  if (counting || lotScanned || scannedItems.length > 0) {
                    void handleCancelCurrentCycle();
                    return;
                  }
                  setSelectedCycleId(null);
                }}
                className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-4 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                Volver
              </button>
            </>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Conteo Cíclico">
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}

        {/* Botón crear nuevo ciclo */}
        <button
          onClick={handleOpenCreateModal}
          className="w-full bg-blue-600 text-white py-4 rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <Plus size={24} />
          <span>Crear Nuevo Ciclo</span>
        </button>

        <div className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400">Devueltos</p>
              <h3 className="text-base font-black text-slate-900 dark:text-slate-100">Ajustes pendientes / devueltos</h3>
            </div>
            <span className="rounded-full bg-amber-100 dark:bg-amber-500/15 px-3 py-1 text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">
              {adjustments.length} pendientes
            </span>
          </div>
          {loadingAdjustments ? (
            <div className="flex items-center justify-center py-4 text-slate-500 dark:text-slate-300">
              <LoaderCircle className="mr-2 animate-spin" size={16} />
              Cargando devoluciones...
            </div>
          ) : adjustments.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-300">No hay ajustes pendientes.</p>
          ) : (
            <div className="space-y-3">
              {adjustments.map((item) => (
                <div key={item.RequestID} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{item.PartNumber || 'Item'}</p>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.PartName || 'Ajuste de inventario'}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Cantidad: {item.Quantity ?? 0} • Lote: {item.LotInventoryID ?? 'N/A'}</p>
                    </div>
                    <span className="rounded-full bg-amber-100 dark:bg-amber-500/15 px-2.5 py-1 text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">
                      {item.StatusDescription || 'Pendiente'}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => handleReviewAdjustment(item.RequestID, 'approve')}
                      disabled={reviewingAdjustmentId === item.RequestID}
                      className="flex-1 rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-black uppercase text-white"
                    >
                      {reviewingAdjustmentId === item.RequestID && reviewAction === 'approve' ? 'Aprobando...' : 'Aprobar'}
                    </button>
                    <button
                      onClick={() => handleReviewAdjustment(item.RequestID, 'reject')}
                      disabled={reviewingAdjustmentId === item.RequestID}
                      className="flex-1 rounded-2xl bg-rose-600 px-3 py-2 text-sm font-black uppercase text-white"
                    >
                      {reviewingAdjustmentId === item.RequestID && reviewAction === 'reject' ? 'Rechazando...' : 'Rechazar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400">Mapa visual</p>
              <h3 className="text-base font-black text-slate-900 dark:text-slate-100">Celdas del conteo</h3>
            </div>
            <span className="rounded-full bg-blue-50 dark:bg-blue-500/15 px-3 py-1 text-[10px] font-black uppercase text-blue-700 dark:text-blue-300">
              {cycles.filter((cycle) => cycle.StatusCode === 'COMPLETED').length}/{cycles.length} completadas
            </span>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 dark:text-slate-300 mb-3">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Completado</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> En proceso</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-200" /> Pendiente</span>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-2 mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400 mb-2">Filtrar rack</p>
            <div className="flex flex-wrap gap-2">
              {rackFilterOptions.map((rackName) => {
                const isActive = mapRackFilter === rackName;
                return (
                  <button
                    key={rackName}
                    type="button"
                    onClick={() => setMapRackFilter(rackName)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {rackName === 'all' ? 'Todos' : rackName}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            {visibleMapRackGroups.map((group) => (
              <div key={group.rackName} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400">Rack {group.rackName}</p>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-300">{group.items.length} celdas</p>
                </div>

                {group.columns.map((column) => (
                  <div key={`${group.rackName}-${column.rackColumn}`} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 p-2">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Columna {column.rackColumn}
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {column.items.map((location) => {
                        const cycle = cycles.find((item) => item.LocationID === location.StorageID);
                        const isCompleted = cycle?.StatusCode === 'COMPLETED';
                        const isInProcess = cycle?.StatusCode === 'IN_PROCESS';
                        const statusClasses = isCompleted
                          ? 'border-emerald-200 dark:border-emerald-600 bg-emerald-500 dark:bg-emerald-600 text-white shadow-emerald-100 dark:shadow-emerald-900/30'
                          : isInProcess
                            ? 'border-blue-200 dark:border-blue-500 bg-blue-500 dark:bg-blue-600 text-white shadow-blue-100 dark:shadow-blue-900/30'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200';

                        return (
                          <button
                            key={location.StorageID}
                            onClick={() => {
                              if (cycle) {
                                void handleSelectCycle(cycle.CycleCountID);
                              }
                            }}
                            className={`rounded-2xl border p-2 text-left transition-all active:scale-95 ${statusClasses}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase">{cycle ? `C${cycle.CycleCountID}` : formatLocationCode(location.RackName, location.RackColumn, location.RackCell)}</span>
                              {isCompleted ? <Check size={12} /> : isInProcess ? <RefreshCw size={12} /> : null}
                            </div>
                            <p className="mt-2 text-[11px] font-black leading-tight">
                              {formatLocationCode(location.RackName, location.RackColumn, location.RackCell)}
                            </p>
                            <p className="text-[9px] font-semibold opacity-80">
                              {isCompleted ? 'Listo' : isInProcess ? 'Activa' : 'Pend.'}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {loadingCycles ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando ciclos...
          </div>
        ) : (
          <div className="space-y-5">
            {cycleRackGroups.map((group, groupIndex) => (
              <div key={group.rackName} className="space-y-4">
                <div className="flex items-center justify-between px-3 py-2 rounded-3xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Rack</p>
                    <h3 className="text-base font-black text-slate-900 dark:text-slate-100">{group.rackName}</h3>
                  </div>
                  <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300">
                    {group.items.length} conteos
                  </span>
                </div>

                {group.columns.map((column, columnIndex) => (
                  <div key={`${group.rackName}-${column.rackColumn}`} className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        Columna {column.rackColumn}
                      </p>
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {column.items.length} celdas
                      </span>
                    </div>

                    {column.items.map((cycle, index) => (
                      <motion.button
                        key={cycle.CycleCountID}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: (groupIndex * 0.05) + (columnIndex * 0.02) + (index * 0.01) }}
                        onClick={() => handleSelectCycle(cycle.CycleCountID)}
                        className="w-full bg-white dark:bg-slate-800/95 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex items-start gap-4 active:scale-[0.98] transition-all"
                      >
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                          cycle.StatusCode === 'COMPLETED' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                          cycle.StatusCode === 'IN_PROCESS' ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                          'bg-slate-50 dark:bg-slate-700/70 text-slate-400 dark:text-slate-300'
                        }`}>
                          {cycle.StatusCode === 'COMPLETED' ? <Check size={28} /> : <RefreshCw size={28} />}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex justify-between items-start gap-2 mb-1">
                            <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase">Ciclo {cycle.CycleCountID}</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md ${
                              cycle.StatusCode === 'COMPLETED' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' :
                              cycle.StatusCode === 'IN_PROCESS' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                              'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200'
                            }`}>
                              {cycle.StatusDescription}
                            </span>
                          </div>
                          <h3 className="text-base font-black text-slate-900 dark:text-slate-100 mb-1 text-left leading-tight">{group.rackName} - Col {cycle.RackColumn} Celda {cycle.RackCell}</h3>
                          <div className="flex justify-between items-center gap-2 text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase">
                            <span className="truncate text-left">{cycle.PartName || 'Sin inventario'}</span>
                            <span className="flex-shrink-0">Items: {cycle.InventoryItemCount || 0}</span>
                          </div>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal para crear nuevo ciclo */}
      {showCreateModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/50 flex items-end z-50"
        >
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            className="w-full bg-white dark:bg-slate-800 rounded-t-[3rem] p-6 space-y-4"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">Crear Nuevo Ciclo</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase mb-2">Escanea el rack</p>
                <input
                  ref={qrInputRef}
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  onKeyDown={handleQrScan}
                  placeholder="Ej.: A-1-1"
                  className="w-full px-4 py-3 border-2 border-slate-200 dark:border-slate-700 rounded-2xl focus:border-blue-500 focus:outline-none font-semibold bg-white dark:bg-slate-700/80 text-slate-900 dark:text-slate-100"
                />
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Formato esperado: Letra-Número-Número, por ejemplo A-1-1.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Filtrar rack</p>
                <div className="flex flex-wrap gap-2">
                  {rackFilterOptions.map((rackName) => {
                    const isActive = selectedRackFilter === rackName;
                    return (
                      <button
                        key={rackName}
                        type="button"
                        onClick={() => setSelectedRackFilter(rackName)}
                        className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase transition-all ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-slate-600 border border-slate-200'
                        }`}
                      >
                        {rackName === 'all' ? 'Todos' : rackName}
                      </button>
                    );
                  })}
                </div>
              </div>

              {loadingLocations ? (
                <div className="flex items-center justify-center py-6 text-slate-500">
                  <LoaderCircle className="mr-2 animate-spin" size={18} />
                  Cargando ubicaciones...
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto space-y-4">
                  {visibleRackLocationGroups.length > 0 ? (
                    visibleRackLocationGroups.map((group) => (
                      <div key={group.rackName} className="space-y-3">
                        <div className="px-4 py-3 rounded-3xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Rack</p>
                              <h3 className="text-base font-black text-slate-900 dark:text-slate-100">{group.rackName}</h3>
                            </div>
                            <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300">
                              {group.items.length} ubicaciones
                            </span>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {group.items.map((location) => (
                            <button
                              key={location.StorageID}
                              onClick={() => handleCreateCycle(location.StorageID)}
                              disabled={creatingCycle}
                              className="w-full text-left rounded-3xl border-2 px-4 py-4 border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/95 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-60"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500">Ubicación</p>
                                  <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{formatLocationCode(location.RackName, location.RackColumn, location.RackCell)}</h4>
                                </div>
                                <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${location.Status === 'occupied' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {location.Status === 'occupied' ? 'Ocupada' : 'Libre'}
                                </span>
                              </div>
                              {location.LocationName ? (
                                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{location.LocationName}</p>
                              ) : null}
                              <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                                {location.OccupiedItemCount ?? 0} items · {location.OccupiedQuantity ?? 0} unidades
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-500">
                      No hay ubicaciones disponibles
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowCreateModal(false)}
              className="w-full bg-slate-100 text-slate-600 py-4 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
            >
              Cancelar
            </button>
          </motion.div>
        </motion.div>
      )}
    </Layout>
  );
};

