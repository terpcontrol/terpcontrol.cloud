using Toybox.System;
using Toybox.Lang;

//
// Functions to create a dict from a json string
//

function str_unescape(p_str) {
  var pos = p_str.find("\\\"");
  while (pos != null) {
    p_str = p_str.substring(0, pos) + p_str.substring(pos + 1, p_str.length());
    pos = p_str.find("\\\"");
  }
  pos = p_str.find("\\\\");
  while (pos != null) {
    p_str = p_str.substring(0, pos) + p_str.substring(pos + 1, p_str.length());
    pos = p_str.find("\\\\");
  }
  pos = p_str.find("\\/");
  while (pos != null) {
    p_str = p_str.substring(0, pos) + p_str.substring(pos + 1, p_str.length());
    pos = p_str.find("\\/");
  }
  return p_str;
}

function read_spaces(p_str, it) {
  while ((it < p_str.length()) && (p_str.substring(it, it + 1).equals(" "))) {
    it++;
  }
return it;
}

function read_number(p_str, it) {
  var it_b = it; // begin
  var type = :number;
  var ret_number = null;

if (it < p_str.length() && (p_str.substring(it, it + 1).equals("-") || p_str.substring(it, it + 1).toNumber() != null)) { // Start with - or digit
   while (it < p_str.length()) {
     var tmp_char = p_str.substring(it, it + 1);
     if (tmp_char.toNumber() != null || tmp_char.equals("-") || tmp_char.equals("+") || tmp_char.equals(".") ||       
          tmp_char.equals("e") || tmp_char.equals("E")) {
        if (tmp_char.equals(".") || tmp_char.equals("e") || tmp_char.equals("E")) {
          type = :float;
        }
        it++;
      } else {
        break;
      }
    }
    
    if (type == :float) {
      ret_number = p_str.substring(it_b, it).toFloat();
    } else {
      ret_number = p_str.substring(it_b, it).toNumber();
    }
    if (ret_number != null) {
      return [ret_number, it];
    }
  }
  return null;
}

function read_string(p_str, it) {
if (it < p_str.length() && p_str.substring(it, it + 1).equals("\"")) { // Start with Quote
    it++;
  
    var it_b = it; // Save begin

   while ((it < p_str.length()) && ! p_str.substring(it, it + 1).equals("\"")) {
     if (p_str.substring(it, it + 1).equals("\\")) { // Escape char
        it++;
      }
      it++;
    }
  
   if (it < p_str.length() && p_str.substring(it, it + 1).equals("\"")) { // End quote
     it++;
      return [str_unescape(p_str.substring(it_b, it - 1)), it];
   }
  }
  return null;
}

function read_name(p_str, it) {
  var it_b = it; // begin
  
if (it < p_str.length() && ! p_str.substring(it, it + 1).toUpper().equals(p_str.substring(it, it + 1).toLower())) { // Start with a letter
   while (it < p_str.length()) {
     var tmp_char = p_str.substring(it, it + 1);
     if (tmp_char.equals("-") || tmp_char.equals("_") || tmp_char.equals(".") ||
            ! (tmp_char.toUpper().equals(tmp_char.toLower())) || // Letter
            tmp_char.toNumber() != null ) { // digit
        it++;
      } else {
        break;
      }
    }
    return [p_str.substring(it_b, it), it];
}
return null;
}

(:typecheck(false))
function read_array(p_str, it) {
var ret_array = [];
var tmp_value;

if (it < p_str.length() && p_str.substring(it, it + 1).equals("[")) { // Begin with [
    it++;
  
   it = read_spaces(p_str, it);
   if (p_str.substring(it, it + 1).equals("]")) { // Empty array but valid
      return [ret_array, it + 1];
    }   

   while (it < p_str.length()) {
   it = read_spaces(p_str, it);

      tmp_value = read_value(p_str, it);
      if (tmp_value == null) {
        return null;
      }
      ret_array.add(tmp_value[0]);
      it = tmp_value[1];
  
   it = read_spaces(p_str, it);
   if (it >= p_str.length() || ! p_str.substring(it, it + 1).equals(",")) {
     break;
   }
      it++;
   }
  
   if (it < p_str.length() && p_str.substring(it, it + 1).equals("]")) { // Bad end of array
      return [ret_array, it + 1];
    }
}
  return null;
}

function read_value(p_str, it) {
  var len = p_str.length();
  if (it < len) {
    var tmp_char = p_str.substring(it, it + 1);
    
    if (tmp_char.equals("\"")) {
      return read_string(p_str, it);
    } else if (tmp_char.equals("-") || tmp_char.toNumber() != null) {
      return read_number(p_str, it);
    } else if (tmp_char.equals("{")) {
      return read_object(p_str, it);
    } else if (tmp_char.equals("[")) {
      return read_array(p_str, it);
    } else if ((it + 3) < len && p_str.substring(it, it + 4).equals("true")) {
      return [true, it+4];
    } else if ((it + 4) < len && p_str.substring(it, it + 5).equals("false")) {
      return [false, it+5];
    } else if ((it + 3) < len && p_str.substring(it, it + 4).equals("null")) {
      return [null, it+4];
    }
  }
  return null;
}

(:typecheck(false))
function read_tuple(p_str, it) {
  var tmp_name = null;
  var tmp_value = null;

//  System.println("Read a tuple " + p_str.substring(it, p_str.length()));

  // Read name
if (it < p_str.length() && p_str.substring(it, it + 1).equals("\"")) {
    tmp_name = read_string(p_str, it);
  } else {
    tmp_name = read_name(p_str, it);  
  }
  if (tmp_name == null) {
    return null;
  }
  it = tmp_name[1];
  
it = read_spaces(p_str, it);
  if (it >= p_str.length() || ! p_str.substring(it, it + 1).equals(":")) {
    return null;
  }
  it++;

it = read_spaces(p_str, it);
  
// Read value
tmp_value = read_value(p_str, it);
  if (tmp_value == null) {
    return null;
  }

return [tmp_name[0], tmp_value[0], tmp_value[1]];
}

(:typecheck(false))
function read_object(p_str, it) {
var ret_obj = {};
var tmp_tuple = null;

//  System.println("Read an object " + p_str.substring(it, p_str.length()));

if (it < p_str.length() && p_str.substring(it, it + 1).equals("{")) { // Start with {
   it++;
  
   it = read_spaces(p_str, it);
   if (p_str.substring(it, it + 1).equals("}")) { // Empty Object but valid
      return [ret_obj, it + 1];
    }   

   while (it < p_str.length()) {
   it = read_spaces(p_str, it);
  
      tmp_tuple = read_tuple(p_str, it);
      if (tmp_tuple == null) {
        return null;
      }
      ret_obj.put(tmp_tuple[0], tmp_tuple[1]);
      it = tmp_tuple[2];
  
   it = read_spaces(p_str, it);
   if (it >= p_str.length() || ! p_str.substring(it, it + 1).equals(",")) {
     break;
   }
      it++;
   }
  
   if (it < p_str.length() && p_str.substring(it, it + 1).equals("}")) { // End of OBJECT
      return [ret_obj, it + 1];
    }
  }
  return null;
}

(:typecheck(false))
public function json_to_dict(p_str) {
  var it = 0;
  var ret_val = null;

  // Bad syntax
  if (p_str != null && (p_str instanceof Lang.String)) {
    //System.println("Extract a json " + p_str);
    it = read_spaces(p_str, it);
    ret_val = read_object(p_str, it);
    if (ret_val == null) {
      return null;
    }
    it = ret_val[1];
    it = read_spaces(p_str, it);
    if (it == p_str.length()) {
      return ret_val[0];
    }
  }
  return null;
}      


//
// Get a value from a string representing a json path(x.y) in a dict
//

/*
function getJsonPathInDict(p_dict, p_path) {
  var dot_pos = p_path.find(".");
    
  if (dot_pos != null && p_dict[p_path.substring(0, dot_pos)] != null) {
    return getJsonPathInDict(p_dict[p_path.substring(0, dot_pos)], p_path.substring(dot_pos + 1, p_path.length()));
  } else {
    return p_dict[p_path];
  }
}
*/

(:typecheck(false))
function getJsonPathInDict(p_dict, p_path) {
  try {
    var dot_pos = p_path.find(".");
    var obr_pos = p_path.find("[");
    var cbr_pos = p_path.find("]");
    
    var len = p_path.length();

    // Report array if not first
    if ((dot_pos != null && obr_pos != null) && dot_pos < obr_pos) {
      obr_pos = null;
    }

    if (obr_pos != null) { // [ is first
      if (obr_pos != 0) {
        return getJsonPathInDict(p_dict[p_path.substring(0, obr_pos)], p_path.substring(obr_pos, len));
      } else {
        var mIndex = p_path.substring(1, cbr_pos).toNumber();

        if (cbr_pos == len - 1) {
          return p_dict[mIndex];
        } else {
          return getJsonPathInDict(p_dict[mIndex], p_path.substring(cbr_pos + 1, len));
        }
      }
    } else if (dot_pos != null) { // . is first
      if (dot_pos == 0) {
        return getJsonPathInDict(p_dict, p_path.substring(1, len));
      } else {
        return getJsonPathInDict(p_dict[p_path.substring(0, dot_pos)], p_path.substring(dot_pos + 1, len));
      }
    } else {
      return p_dict[p_path]; // no more . or [
    }  

  } catch (e) {
   return null;
  }
}
