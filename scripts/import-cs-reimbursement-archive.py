"""Import the customer-service expense workbook as historical, non-payable claims."""
import argparse
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import PurePosixPath
import os
import re
import subprocess
from xml.etree import ElementTree
from zipfile import ZipFile

CATEGORIES = {"业务类": "advance", "垫付": "advance", "办公类": "purchase",
              "话费": "other", "维修类": "other", "其他": "other"}
MIMES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def xml(workbook, name):
    root = ElementTree.fromstring(workbook.read(name))
    for element in root.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]
    return root


def relationships(workbook, name):
    return {element.attrib["Id"]: element.attrib["Target"] for element in xml(workbook, name)}


def archive_rows(path):
    with ZipFile(path) as workbook:
        tabs = xml(workbook, "xl/workbook.xml").find("sheets")
        tab = next(t for t in tabs if t.get("name") == "客服报销明细")
        relation = next(value for key, value in tab.attrib.items() if key.endswith("}id"))
        sheet_paths = relationships(workbook, "xl/_rels/workbook.xml.rels")
        sheet = xml(workbook, "xl/" + sheet_paths[relation])
        strings = ["".join(t.text or "" for t in item.iter("t"))
                   for item in xml(workbook, "xl/sharedStrings.xml")]
        image_paths = relationships(workbook, "xl/_rels/cellimages.xml.rels")
        images = {}
        for picture in xml(workbook, "xl/cellimages.xml").iter("pic"):
            image_key = picture.find(".//cNvPr").attrib["name"]
            embed = next(value for key, value in picture.find(".//blip").attrib.items()
                         if key.endswith("}embed"))
            images[image_key] = image_paths[embed]

        result = []
        for row in sheet.find("sheetData"):
            line = int(row.attrib["r"])
            if line <= 2:
                continue
            cells = {}
            for cell in row:
                value = cell.findtext("v") or cell.findtext("f") or ""
                if value and cell.get("t") == "s":
                    value = strings[int(value)]
                if value:
                    cells[cell.attrib["r"].rstrip("0123456789")] = value.strip()
            if not cells.get("G") and not cells.get("E"):
                continue
            if not all(cells.get(column) for column in "ABEFG"):
                raise ValueError(f"Excel 第 {line} 行缺少必需字段")
            expense_date = date(1899, 12, 30) + timedelta(days=int(cells["B"]))
            amount = Decimal(cells["G"])
            if amount <= 0 or amount != amount.quantize(Decimal("0.01")):
                raise ValueError(f"Excel 第 {line} 行金额无效")
            proofs = []
            notes = [f"来源：客服报销明细，Excel 第 {line} 行（原序号 {cells['A']}，原分类 {cells['F']}）"]
            if not cells.get("D"):
                notes.append("原表姓名为空")
            for column in "HIJK":
                value = cells.get(column, "")
                if "DISPIMG" in value:
                    image_key = re.search(r'DISPIMG\("([^"]+)"', value).group(1)
                    target = images[image_key]
                    image = workbook.read("xl/" + target)
                    mime = MIMES[PurePosixPath(target).suffix.lower()]
                    if not 0 < len(image) <= 16 * 1024 * 1024:
                        raise ValueError(f"Excel 第 {line} 行图片大小超限")
                    proofs.append((mime, image))
                elif value:
                    notes.append(value)
            key_source = "\n".join([str(line), *(cells.get(c, "") for c in "ABCDEFG"),
                                    *(sha256(proof).hexdigest() for _, proof in proofs)])
            key = "xlsx:" + sha256(key_source.encode()).hexdigest()
            result.append((key, cells.get("D") or "报销人待核实", cells.get("C", ""),
                           CATEGORIES[cells["F"]], cells["E"], amount, str(expense_date),
                           "\n".join(notes), proofs))
    if not result:
        raise ValueError("找不到报销明细")
    return result


def sql_text(value):
    return f"convert_from(decode('{value.encode().hex()}','hex'),'UTF8')"


def load(rows, username):
    keys = ",".join(sql_text(row[0]) for row in rows)
    commands = ["BEGIN;", "CREATE TEMP TABLE reimbursement_import_actor (id uuid NOT NULL);",
                f"INSERT INTO reimbursement_import_actor VALUES ((SELECT id FROM users WHERE role='admin' AND is_active AND username={sql_text(username)}));"]
    actor = "(SELECT id FROM reimbursement_import_actor)"
    for key, claimant, department, category, purpose, amount, expense_date, note, proofs in rows:
        key = sql_text(key)
        commands.append(f"""WITH imported AS (INSERT INTO reimbursement_claims
            (request_key,claimant,department,category,purpose,amount_cny,expense_date,claim_date,
             receipt_ref,note,status,workflow_stage,created_by)
            VALUES ({key},{sql_text(claimant)},{sql_text(department)},{sql_text(category)},
              {sql_text(purpose)},{amount},'{expense_date}','{expense_date}',{key},{sql_text(note)},
              'historical','historical',{actor})
            ON CONFLICT (request_key) DO NOTHING RETURNING id)
            INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data)
            SELECT {actor},'reimbursement_historical_import','reimbursement_claim',id::text,
              jsonb_build_object('source', 'excel', 'proofCount', {len(proofs)})
            FROM imported;""")
        for pos, (mime, image) in enumerate(proofs):
            commands.append(f"""INSERT INTO reimbursement_proofs(claim_id,position,mime_type,image_bytes)
                SELECT id,{pos},'{mime}',decode('{image.hex()}','hex') FROM reimbursement_claims
                WHERE request_key={key} AND workflow_stage='historical'
                ON CONFLICT (claim_id,position) DO NOTHING;""")
    commands.extend([f"""SELECT count(*)||' records, CNY '||sum(amount_cny)||', '||
                         (SELECT count(*) FROM reimbursement_proofs p JOIN reimbursement_claims c ON c.id=p.claim_id
                            WHERE c.request_key IN ({keys}) AND c.workflow_stage='historical')||' images'
                         FROM reimbursement_claims WHERE request_key IN ({keys}) AND workflow_stage='historical';""", "COMMIT;"])
    subprocess.run(["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", os.environ["DATABASE_URL"]],
                   input="\n".join(commands).encode(), check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook")
    parser.add_argument("--apply-as-admin")
    args = parser.parse_args()
    rows = archive_rows(args.workbook)
    grouped = Counter((row[1], row[2], row[4], row[5], row[6]) for row in rows)
    print(f"{len(rows)} records, CNY {sum(row[5] for row in rows):.2f}, "
          f"{sum(len(row[-1]) for row in rows)} images, "
          f"{sum(row[1] == '报销人待核实' for row in rows)} missing claimants, "
          f"{sum(count > 1 for count in grouped.values())} matching row groups", flush=True)
    if args.apply_as_admin:
        load(rows, args.apply_as_admin)
