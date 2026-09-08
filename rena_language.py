"""Normalize English operational questions for the deterministic query parser.

Only vocabulary is normalized. Numbers, dates, ACRISS codes and license plates
are preserved. The original Portuguese query vocabulary remains supported.
"""
import re

_ALIASES = {
    'how is the fleet': 'como esta a frota',
    'what should i prioritize': 'o que devo priorizar',
    'how many vehicles': 'quantas viaturas',
    'find reservations for': 'encontrar reservas para',
    'eligible for island transfers': 'bloquear para ilhas',
    'the day after tomorrow': 'depois de amanha',
    'day after tomorrow': 'depois de amanha',
    'next week': 'proxima semana', 'this week': 'esta semana',
    'all stations': 'todas as estacoes', 'all groups': 'todos os grupos',
    'all statuses': 'todos os estados', 'all categories': 'todas as categorias',
    'by station': 'por estacao', 'by pool': 'por pool',
    'by group': 'por grupo', 'by category': 'por categoria',
    'in the workshop': 'em oficina', 'in workshop': 'em oficina',
    'in transit': 'em transito', 'in pool': 'na pool',
    'in the pool': 'na pool', 'at station': 'na estacao',
    'without a license plate': 'sem matricula',
    'license plates': 'matriculas', 'license plate': 'matricula',
    'unassigned': 'sem matricula', 'time slots': 'slots', 'time slot': 'slot',
    'light commercial vehicles': 'vcl', 'lcv': 'vcl',
    'seaters': 'lugares', 'seater': 'lugares', 'seats': 'lugares',
    'lisbon': 'lisboa', 'oporto': 'porto', 'airport': 'aeroporto',
    'downtown': 'centro', 'north': 'norte', 'south': 'sul', 'central': 'centro',
    'islands': 'ilhas', 'island': 'ilhas', 'electric': 'eletricos',
    'compact': 'compactos', 'planning': 'planeamento',
    'occupancy': 'ocupacao', 'capacity': 'capacidade',
    'balances': 'saldos', 'balance': 'saldo', 'shortages': 'negativos',
    'shortage': 'negativo', 'negative': 'negativos',
    'groups': 'grupos', 'group': 'grupo', 'stations': 'estacoes', 'station': 'estacao',
    'reservations': 'reservas', 'reservation': 'reserva',
    'vehicles': 'viaturas', 'vehicle': 'viatura', 'fleet': 'frota',
    'workshop': 'oficina', 'available': 'disponiveis', 'rented': 'alugadas',
    'preparation': 'preparacao', 'returns': 'devolucoes', 'pickups': 'levantamentos',
    'loads': 'cargas', 'load': 'carga', 'transport': 'transporte',
    'completed': 'concluido', 'duplicates': 'duplicados', 'duplicate': 'duplicados',
    'manufacturers': 'marcas', 'models': 'modelos', 'model': 'modelo',
    'analyze': 'analisa', 'analyse': 'analisa', 'briefing': 'diagnostico',
    'prioritize': 'priorizar', 'priorities': 'prioridades', 'overview': 'resumo',
    'exceed': 'ultrapassam', 'limits': 'limites', 'limit': 'limite',
    'tomorrow': 'amanha', 'today': 'hoje', 'yesterday': 'ontem',
    'next': 'proximos', 'days': 'dias', 'day': 'dia', 'week': 'semana',
    'monday': 'segunda', 'tuesday': 'terca', 'wednesday': 'quarta',
    'thursday': 'quinta', 'friday': 'sexta', 'saturday': 'sabado', 'sunday': 'domingo',
    'above': 'acima de', 'below': 'abaixo de', 'lowest': 'menor', 'highest': 'maior',
    'and': 'e', 'only': 'apenas', 'which': 'que', 'hello': 'ola', 'help': 'ajuda',
    'delete': 'apaga', 'cancel': 'cancela', 'create': 'cria', 'send': 'envia',
    'change': 'altera', 'update': 'atualiza', 'confirm': 'confirma',
}
_PATTERN = re.compile(r'(?<!\w)(?:' + '|'.join(re.escape(k) for k in sorted(_ALIASES, key=len, reverse=True)) + r')(?!\w)')


def normalize_query(text):
    text = re.sub(r'(?<=\d)-(?=seater)', ' ', text)
    return _PATTERN.sub(lambda match: _ALIASES[match[0]], text)
