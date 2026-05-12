import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, X } from 'lucide-react';
import { companiesApi } from '@/services/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/utils';

interface Company {
  id: string;
  name: string;
  domain?: string;
}

interface CompanySelectProps {
  value: string | null;
  onChange: (companyId: string | null) => void;
  label?: string;
  placeholder?: string;
}

export function CompanySelect({ value, onChange, label, placeholder = 'Buscar empresa...' }: CompanySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debouncedSearch = useDebouncedValue(searchText, 200);
  const inputId = label?.toLowerCase().replace(/\s+/g, '-');

  const { data: companiesData } = useQuery({
    queryKey: ['companies', 'select', { search: debouncedSearch }],
    queryFn: () => companiesApi.list({ limit: 100, search: debouncedSearch || undefined }),
    staleTime: 60_000,
    enabled: isOpen,
  });

  const companies: Company[] = companiesData?.data?.data || [];

  // Fetch selected company name for display
  const { data: selectedData } = useQuery({
    queryKey: ['companies', 'detail', value],
    queryFn: () => companiesApi.get(value!),
    staleTime: 60_000,
    enabled: !!value,
  });

  const selectedCompany: Company | null = selectedData?.data?.data || null;
  const displayValue = !isOpen && selectedCompany ? selectedCompany.name : searchText;

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchText('');
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll active option into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const option = listRef.current.children[activeIndex] as HTMLElement;
      option?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleSelect = useCallback((companyId: string | null) => {
    onChange(companyId);
    setIsOpen(false);
    setSearchText('');
    setActiveIndex(-1);
    inputRef.current?.blur();
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalOptions = companies.length + 1; // +1 for "Sin empresa"

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setActiveIndex((prev) => (prev + 1) % totalOptions);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setActiveIndex((prev) => (prev <= 0 ? totalOptions - 1 : prev - 1));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && activeIndex >= 0) {
          if (activeIndex === 0) {
            handleSelect(null);
          } else {
            const company = companies[activeIndex - 1];
            if (company) handleSelect(company.id);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchText('');
        setActiveIndex(-1);
        break;
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSearchText('');
  };

  const listboxId = `${inputId}-listbox`;

  return (
    <div className="w-full" ref={containerRef}>
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
          <Building2 className="h-4 w-4" />
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={isOpen && activeIndex >= 0 ? `company-option-${activeIndex}` : undefined}
          className={cn('form-input pl-10 pr-16')}
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => {
            setSearchText(e.target.value);
            if (!isOpen) setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-slate-400 hover:text-slate-600 rounded"
              aria-label="Quitar empresa"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="text-slate-400 pointer-events-none">
            <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
          </div>
        </div>

        {isOpen && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            <li
              id="company-option-0"
              role="option"
              aria-selected={activeIndex === 0}
              className={cn(
                'px-3 py-2 cursor-pointer text-sm text-slate-500 italic',
                activeIndex === 0 && 'bg-primary-50 text-primary-700'
              )}
              onMouseEnter={() => setActiveIndex(0)}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(null); }}
            >
              Sin empresa
            </li>
            {companies.map((company, index) => {
              const optionIndex = index + 1;
              return (
                <li
                  key={company.id}
                  id={`company-option-${optionIndex}`}
                  role="option"
                  aria-selected={activeIndex === optionIndex}
                  className={cn(
                    'px-3 py-2 cursor-pointer',
                    activeIndex === optionIndex && 'bg-primary-50',
                    value === company.id && 'font-medium text-primary-700'
                  )}
                  onMouseEnter={() => setActiveIndex(optionIndex)}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(company.id); }}
                >
                  <div className="text-sm font-medium text-slate-900">{company.name}</div>
                  {company.domain && (
                    <div className="text-xs text-slate-500">{company.domain}</div>
                  )}
                </li>
              );
            })}
            {companies.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">
                No se encontraron empresas
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
