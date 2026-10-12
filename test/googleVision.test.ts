import test from "node:test"
import assert from "node:assert/strict"
import {spatialLines} from "../src/googleVision.js"
import {parseOcrText} from "../src/parser.js"

test("OCR left-column-first output recovers label and amount from word positions",()=>{
  const word=(description:string,x:number,y:number)=>({description,boundingPoly:{vertices:[{x,y},{x:x+60,y},{x:x+60,y:y+20},{x,y:y+20}]}})
  const annotations=[{description:"공급가액\n부가세\n결제금액\n[승인정보]\n10,000원\n1,000원\n11,000원"},word("공급가액",0,100),word("부가세",0,130),word("결제금액",0,160),word("10,000원",300,101),word("1,000원",300,131),word("11,000원",300,161)]
  const lines=spatialLines(annotations)
  assert.equal(parseOcrText(annotations[0].description).totalAmount,null)
  const actual=parseOcrText(lines)
  assert.equal(actual.totalAmount,11000)
  assert.equal(actual.supplyAmount,10000)
  assert.equal(actual.vatAmount,1000)
  assert.equal(spatialLines([{description:"no geometry"}]),"")
})
