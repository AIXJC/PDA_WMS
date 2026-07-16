import { create } from 'zustand';

export interface Product {
  sku: string;
  name: string;
  description: string;
  stock: number;
  location: string;
  lot?: string;
  series?: string;
  expiryDate?: string;
  image?: string;
  lastMovement?: string;
}

interface InventoryState {
  products: Product[];
  scannedHistory: Product[];
  addProduct: (product: Product) => void;
  updateStock: (sku: string, amount: number) => void;
  addToHistory: (product: Product) => void;
  clearHistory: () => void;
}

// Mock data for initial state
const MOCK_PRODUCTS: Product[] = [
  {
    sku: 'PROD-001',
    name: 'Caja de Herramientas Industrial',
    description: 'Caja de acero reforzado para herramientas pesadas.',
    stock: 45,
    location: 'A-12-04',
    lot: 'L-2024-001',
    expiryDate: '2028-12-31',
    lastMovement: '2024-05-15',
    image: 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=400&h=400&fit=crop'
  },
  {
    sku: 'PROD-002',
    name: 'Guantes de Protección Nitrilo',
    description: 'Guantes resistentes a químicos y cortes.',
    stock: 120,
    location: 'B-05-02',
    lot: 'L-2024-005',
    lastMovement: '2024-05-17',
    image: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400&h=400&fit=crop'
  },
  {
    sku: 'PROD-003',
    name: 'Casco de Seguridad V-Gard',
    description: 'Casco de alta visibilidad con suspensión de 4 puntos.',
    stock: 12,
    location: 'C-01-01',
    lot: 'L-2023-098',
    lastMovement: '2024-05-10',
    image: 'https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=400&h=400&fit=crop'
  }
];

export const useInventoryStore = create<InventoryState>((set) => ({
  products: MOCK_PRODUCTS,
  scannedHistory: [],
  addProduct: (product) => set((state) => ({ products: [...state.products, product] })),
  updateStock: (sku, amount) => set((state) => ({
    products: state.products.map((p) => p.sku === sku ? { ...p, stock: p.stock + amount } : p)
  })),
  addToHistory: (product) => set((state) => ({
    scannedHistory: [product, ...state.scannedHistory.slice(0, 19)]
  })),
  clearHistory: () => set({ scannedHistory: [] }),
}));

export default useInventoryStore;
