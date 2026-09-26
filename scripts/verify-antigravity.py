#!/usr/bin/env python3
"""Independent read-only primary-generation counter check (Python standard library).
Usage: python3 scripts/verify-antigravity.py /path/to/conversation.db
Does NOT import the JavaScript parser, apply identity aliases, price tokens,
modify original DBs, or print conversation text. Counts primary + retry usage
from gen_metadata only; standalone steps may legitimately add further usage.
Private field semantics remain a reference, not an official Google contract.
"""
import argparse, collections, hashlib, json, pathlib, sqlite3, sys
MAX_BLOB=8*1024*1024
MAX_ROWS=50000

def decode(data):
    if len(data)>MAX_BLOB: raise ValueError('blob-size-limit')
    i=0; count=0; result={}
    def varint():
        nonlocal i
        value=0
        for shift in range(0,70,7):
            if i>=len(data): raise ValueError('truncated-varint')
            byte=data[i];i+=1
            if shift==63 and byte>1:raise ValueError('overflow')
            value|=(byte&127)<<shift
            if not byte&128:return value
        raise ValueError('overflow')
    while i<len(data):
        count+=1
        if count>100000:raise ValueError('field-limit')
        tag=varint();field=tag>>3;wire=tag&7
        if not field:raise ValueError('invalid-field')
        if wire==0:value=varint()
        elif wire in (1,2,5):
            size=varint() if wire==2 else 8 if wire==1 else 4
            if size>len(data)-i:raise ValueError('truncated-field')
            value=data[i:i+size];i+=size
        else:raise ValueError('unsupported-wire')
        result.setdefault(field,[]).append(value)
    return result

def single(fields,n,default=None):
    values=fields.get(n,[])
    if len(values)>1:raise ValueError('duplicate-singular')
    return values[0] if values else default

def check(file):
    file=pathlib.Path(file).absolute()
    for p in (file,pathlib.Path(str(file)+'-wal'),pathlib.Path(str(file)+'-shm')):
        if p.is_symlink():raise ValueError('symlink-refused')
    if not file.is_file():raise ValueError('database-missing')
    connection=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True,timeout=1)
    connection.execute('PRAGMA query_only=ON');connection.execute('PRAGMA trusted_schema=OFF');connection.execute('BEGIN')
    totals=dict(records=0,input=0,normalInput=0,cacheRead=0,cacheWrite=0,output=0,total=0)
    groups=collections.Counter();rows=0;bytes_read=0;missing=collections.Counter()
    try:
        for index,data in connection.execute('SELECT idx,CASE WHEN length(data)<=8388608 THEN data ELSE NULL END FROM gen_metadata ORDER BY idx'):
            if not isinstance(data,bytes):raise ValueError('invalid-or-oversize-blob')
            rows+=1;bytes_read+=len(data)
            if rows>MAX_ROWS or bytes_read>128*1024*1024:raise ValueError('read-limit')
            root=decode(data);chat=decode(single(root,1,b''));group=single(root,4)
            if isinstance(group,bytes):groups[hashlib.sha256(group).hexdigest()]+=1
            usage=[]
            if 4 in chat:usage.append(single(chat,4))
            for retry in chat.get(17,[]):
                nested=decode(retry)
                if 2 in nested:usage.append(single(nested,2))
            for data in usage:
                u=decode(data)
                if not any(k in u for k in [2,3,4,5]):continue
                values={key:single(u,n,0) for key,n in [('normalInput',2),('cacheWrite',4),('cacheRead',5),('output',3)]}
                if any(not isinstance(v,int) or not 0<=v<=1000000000 for v in values.values()):raise ValueError('invalid-counter')
                for key,n in [('normalInput',2),('cacheWrite',4),('cacheRead',5),('output',3)]:
                    if n not in u:missing[key]+=1
                count=values['normalInput']+values['cacheRead']+values['cacheWrite']+values['output']
                if count==0:continue
                totals['records']+=1
                if totals['records']>MAX_ROWS:raise ValueError('usage-count-limit')
                for key,value in values.items():totals[key]+=value
                totals['input']+=count-values['output'];totals['total']+=count
    finally:connection.close()
    return dict(schema='token-meter.independent-primary-check.v1',status='read-completed',primary=totals,generationRows=rows,
                repeatedGroupIds=sum(n>1 for n in groups.values()),largestGroup=max(groups.values(),default=0),missingCounters=dict(missing),
                note='gen_metadata main + retry only. No alias merging, no standalone steps, no epoch boundary, no pricing. Private field meanings are not independently certified.')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('database');args=parser.parse_args()
    try:print(json.dumps(check(args.database),ensure_ascii=False,indent=2))
    except Exception as exc:
        # Do not include paths, queries or body data from native SQLite errors.
        print(json.dumps({'status':'error','category':type(exc).__name__,'message':'원본 DB 읽기 또는 지원 형식 검증 실패. 파일을 수정하지 않았습니다.'},ensure_ascii=False));return 1
    return 0
if __name__=='__main__':sys.exit(main())
