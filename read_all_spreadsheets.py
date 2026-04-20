import pandas as pd
import sys

pd.set_option('display.max_columns', None)
pd.set_option('display.max_rows', None)
pd.set_option('display.width', None)
pd.set_option('display.max_colwidth', 50)

files = [
    (r"C:\Users\rajar\Downloads\holdings-LXY076.xlsx", None),
    (r"C:\Users\rajar\Downloads\Stocks_Holdings_Statement_8336369076_2026-03-08.xlsx", None),
    (r"C:\Users\rajar\Downloads\IND-HOLDINGS_REPORTXX24034908-2026-03-08-V04 (1).xls", 'xlrd'),
    (r"C:\Users\rajar\Downloads\Stocks_PnL_8336369076_15-09-2024_07-03-2026_report (1).xlsx", None),
    (r"C:\Users\rajar\Downloads\IND-HOLDINGS_REPORTXX24034908-2026-03-08-V04.xls", 'xlrd'),
    (r"C:\Users\rajar\Downloads\pnl-LXY076.xlsx", None),
    (r"C:\Users\rajar\Downloads\Stocks_PnL_8336369076_15-09-2024_07-03-2026_report.xlsx", None),
]

for filepath, engine in files:
    print("=" * 120)
    print(f"FILE: {filepath}")
    print("=" * 120)
    try:
        # First read all sheet names
        if engine:
            xls = pd.ExcelFile(filepath, engine=engine)
        else:
            xls = pd.ExcelFile(filepath)
        sheet_names = xls.sheet_names
        print(f"Sheet names: {sheet_names}")
        print()

        for sheet in sheet_names:
            print(f"--- Sheet: '{sheet}' ---")
            if engine:
                df = pd.read_excel(filepath, sheet_name=sheet, engine=engine, header=None)
            else:
                df = pd.read_excel(filepath, sheet_name=sheet, header=None)

            print(f"Shape: {df.shape} (rows={df.shape[0]}, cols={df.shape[1]})")
            print()
            print("RAW DATA (no header inference):")
            print(df.to_string(index=True))
            print()

            # Also try with header inference
            if engine:
                df2 = pd.read_excel(filepath, sheet_name=sheet, engine=engine)
            else:
                df2 = pd.read_excel(filepath, sheet_name=sheet)
            print(f"COLUMNS (with header): {list(df2.columns)}")
            print(f"DTYPES:\n{df2.dtypes}")
            print()
            print("DATA (with header):")
            print(df2.to_string(index=True))
            print()
    except Exception as e:
        print(f"ERROR reading file: {e}")
        import traceback
        traceback.print_exc()
    print()
