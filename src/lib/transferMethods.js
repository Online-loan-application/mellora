import { ArrowLeftRight, AtSign, CircleDollarSign, Coins, Landmark, WalletCards } from 'lucide-react'

export const transferMethods = [
  {
    id: 'bank', name: 'Bank transfer', provider: '', icon: Landmark,
    description: 'Send to a saved bank account or IBAN.',
    holderLabel: 'Account holder', holderPlaceholder: 'Full name on the account',
    destinationLabel: 'Account number or IBAN', destinationPlaceholder: 'Account or IBAN number',
    destinationMaxLength: 34,
  },
  {
    id: 'paypal', name: 'PayPal', provider: 'PayPal', icon: WalletCards,
    description: 'Use a saved PayPal email address.',
    holderLabel: 'PayPal account name', holderPlaceholder: 'Name on the PayPal account',
    destinationLabel: 'PayPal email', destinationPlaceholder: 'name@example.com',
    destinationType: 'email', destinationAutoComplete: 'email', destinationMaxLength: 120,
  },
  {
    id: 'usdt', name: 'USDT', provider: 'USDT', icon: Coins,
    description: 'Send to a TRC20, ERC20, or BEP20 wallet.',
    holderLabel: 'Wallet label', holderPlaceholder: 'For example, My USDT wallet',
    destinationLabel: 'USDT wallet address', destinationPlaceholder: 'Enter the wallet address',
    destinationMaxLength: 128, networks: ['TRC20', 'ERC20', 'BEP20'],
  },
  {
    id: 'cash_app', name: 'Cash App', provider: 'Cash App', icon: CircleDollarSign,
    description: 'Use a saved $Cashtag.',
    holderLabel: 'Cash App account name', holderPlaceholder: 'Name on the Cash App account',
    destinationLabel: '$Cashtag', destinationPlaceholder: '$yourcashtag',
    destinationMaxLength: 30,
  },
  {
    id: 'wise', name: 'Wise', provider: 'Wise', icon: ArrowLeftRight,
    description: 'Use a saved Wise email address.',
    holderLabel: 'Wise account name', holderPlaceholder: 'Name on the Wise account',
    destinationLabel: 'Wise email', destinationPlaceholder: 'name@example.com',
    destinationType: 'email', destinationAutoComplete: 'email', destinationMaxLength: 120,
  },
  {
    id: 'venmo', name: 'Venmo', provider: 'Venmo', icon: AtSign,
    description: 'Use a saved Venmo username.',
    holderLabel: 'Venmo account name', holderPlaceholder: 'Name on the Venmo account',
    destinationLabel: 'Venmo username', destinationPlaceholder: '@username',
    destinationMaxLength: 50,
  },
]

export const getTransferMethod = (id) => transferMethods.find((method) => method.id === id)

export const createMethodDetails = (methodId = 'bank', fullName = '') => {
  const method = getTransferMethod(methodId) || transferMethods[0]
  return {
    account_holder: method.id === 'usdt' ? '' : fullName,
    bank_name: method.provider,
    account_number: '',
    routing_number: '',
    method: method.id,
    network: method.id === 'usdt' ? 'TRC20' : '',
  }
}

export const detailsFromSaved = (account) => ({
  account_holder: account.account_holder || '',
  bank_name: account.bank_name || '',
  account_number: account.account_number || '',
  routing_number: account.routing_number || '',
  method: account.method || 'bank',
  network: account.network || '',
})

export const destinationSummary = (details) => {
  const value = details.account_number || ''
  if (details.method === 'bank') return `Account ending in ${value.slice(-4)}`
  if (details.method === 'usdt') return `${details.network} · ${value.slice(0, 8)}…${value.slice(-6)}`
  return value
}

export const validateMethodDetails = (details) => {
  if (details.account_holder.length < 2) return 'Enter a recipient name or wallet label.'
  if (details.method === 'bank') {
    if (details.bank_name.length < 2) return 'Enter the recipient bank name.'
    if (details.account_number.length < 4 || details.account_number.length > 34) return 'Enter a valid account number or IBAN.'
    return ''
  }
  if ((details.method === 'paypal' || details.method === 'wise')
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.account_number)) {
    return `Enter a valid ${getTransferMethod(details.method).name} email address.`
  }
  if (details.method === 'usdt') {
    if (!['TRC20', 'ERC20', 'BEP20'].includes(details.network)) return 'Choose a USDT network.'
    const validTrc20 = details.network === 'TRC20' && /^T[A-Za-z0-9]{33}$/.test(details.account_number)
    const validEvm = ['ERC20', 'BEP20'].includes(details.network) && /^0x[a-fA-F0-9]{40}$/.test(details.account_number)
    if (!validTrc20 && !validEvm) return `Enter a valid ${details.network} wallet address.`
    return ''
  }
  if (details.method === 'cash_app' && !/^\$[A-Za-z0-9_]{1,24}$/.test(details.account_number)) {
    return 'Enter a valid $Cashtag, beginning with $.'
  }
  if (details.method === 'venmo' && !/^@?[A-Za-z0-9_-]{2,50}$/.test(details.account_number)) {
    return 'Enter a valid Venmo username.'
  }
  return ''
}
